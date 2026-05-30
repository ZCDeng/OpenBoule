/**
 * 工作流引擎（U4）。
 *
 * 把状态机（state.ts）+ 可靠性 DB 层（checkpoint.ts）+ 事件缓冲（events.ts）+ phase 运行器（phases/）
 * 用 BullMQ Worker / FlowProducer 串成 7-phase HITL 流水线。
 *
 * 设计要点：
 * - 每个 phase 完成即 checkpoint（status=paused_for_approval），人审批后才 enqueue 下一 phase。
 *   BullMQ 无原生 HITL —— 用 Postgres 状态字段 + 事件实现，前端监听 workflow-status-changed 刷新。
 * - 审批 / redo / augment 经 CAS 占用 checkpoint，rowCount≠1 → 409（防双击 / 重试重复 enqueue）。
 * - Phase 2 fan-out：FlowProducer children + aggregator（waiting-children），ignoreDependencyOnFailure
 *   让失败 researcher 不阻塞整体（partial result）。
 * - Phase 4 serial：3 editor 串行 + 放行闸；未达标取最高稿标 below_threshold 兜底。
 *   （注：3 editor 在单个 phase4 job 内顺序跑 —— serial 顺序 + 放行闸 + 兜底全保留；
 *    plan 的「每 editor 独立 job + waitUntilFinished 链」作后续细化，对可靠性无增益因 phase 才是恢复单元。）
 * - 可靠性：每个 phase attempt 取 2min lease + 30s heartbeat；失联由 recoverStalled 扫描 + CAS 单赢家恢复。
 *
 * agentRunner 由外部注入（生产 = U3 runRole + U2 role 加载，在 U6 组装；测试 = mock），引擎不绑真 API。
 */

import type { Job, Queue, Worker, FlowProducer } from "bullmq";
import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { DB } from "../db/client.ts";
import {
  PHASES,
  isPhaseId,
  resolveNextPhase,
  type PhaseId,
} from "./state.ts";
import {
  idempotencyKey,
  recordAttempt,
  markAttemptRunning,
  heartbeat,
  completeAttempt,
  failAttempt,
  pauseForApproval,
  approveCAS,
  rejectCAS,
  claimCheckpointToRunning,
  resumeRunning,
  nextAttemptNumber,
  findOrphanAttempts,
  recoverCAS,
  writeArtifactIdempotent,
} from "./checkpoint.ts";
import { EventReplayBuffer, type EventSink } from "./events.ts";
import {
  runSinglePhase,
  runResearchChild,
  aggregateResearch,
  runSerialReview,
  type AgentRunner,
} from "./phases/index.ts";
import {
  PHASE_QUEUE,
  createConnection,
  makeQueue,
  makeFlowProducer,
  makeWorker,
} from "./queues.ts";

// ── job 名 ──
const JOB_SINGLE = "phase-single";
const JOB_SERIAL = "phase-serial";
const JOB_AGGREGATE = "phase-aggregate";
const JOB_RESEARCH_CHILD = "phase-research-child";

/** checkpoint 决断冲突 → 调用方映射 HTTP 409。 */
export class CheckpointConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "CheckpointConflictError";
  }
}

interface WorkflowRow {
  status: string;
  currentPhase: PhaseId;
}

export interface EngineOptions {
  agentRunner: AgentRunner;
  /** 复用外部 Redis 连接；省略则自建（close 时一并 quit）。 */
  connection?: Redis;
  sink?: EventSink;
  /** fan-out researcher 数（默认读 workflow.axes 长度，再兜底 3）。 */
  researcherCount?: (workflowId: string) => Promise<number>;
  editorCount?: number;
  leaseSeconds?: number;
  heartbeatSeconds?: number;
  bufferCapacity?: number;
  workerConcurrency?: number;
  /** 队列名（多租户/测试隔离用）；默认 PHASE_QUEUE。 */
  queueName?: string;
  /** worker 身份（多实例并发恢复时区分；省略用随机短 id 由调用方传入避免 Date/random 依赖）。 */
  workerId: string;
}

export class WorkflowEngine {
  private readonly db: DB;
  private readonly agentRunner: AgentRunner;
  private readonly connection: Redis;
  private readonly ownsConnection: boolean;
  // Worker 跑阻塞命令（BRPOPLPUSH），必须独占连接，不与 queue/flow 共用（否则阻塞会卡住生产端命令）。
  private readonly workerConnection: Redis;
  private readonly buffer: EventReplayBuffer;
  private readonly leaseSeconds: number;
  private readonly heartbeatSeconds: number;
  private readonly editorCount: number;
  private readonly workerConcurrency: number;
  private readonly workerId: string;
  private readonly queueName: string;
  private readonly researcherCountFn?: (workflowId: string) => Promise<number>;

  private queue?: Queue;
  private flow?: FlowProducer;
  private worker?: Worker;

  constructor(db: DB, opts: EngineOptions) {
    this.db = db;
    this.agentRunner = opts.agentRunner;
    this.ownsConnection = !opts.connection;
    this.connection = opts.connection ?? createConnection();
    this.workerConnection = createConnection(); // 始终独占
    this.buffer = new EventReplayBuffer({ capacity: opts.bufferCapacity, sink: opts.sink });
    this.leaseSeconds = opts.leaseSeconds ?? 120;
    this.heartbeatSeconds = opts.heartbeatSeconds ?? 30;
    this.editorCount = opts.editorCount ?? 3;
    this.workerConcurrency = opts.workerConcurrency ?? 4;
    this.workerId = opts.workerId;
    this.queueName = opts.queueName ?? PHASE_QUEUE;
    this.researcherCountFn = opts.researcherCount;
  }

  /** 暴露事件缓冲（U6/U7 SSE 补发用）。 */
  get events(): EventReplayBuffer {
    return this.buffer;
  }

  /** 起 worker + 队列原语。 */
  start(): void {
    this.queue = makeQueue(this.connection, this.queueName);
    this.flow = makeFlowProducer(this.connection);
    this.worker = makeWorker(this.workerConnection, (job) => this.process(job), this.workerConcurrency, this.queueName);
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.flow?.close();
    await this.queue?.close();
    await this.workerConnection.quit();
    if (this.ownsConnection) await this.connection.quit();
  }

  // ── 公开编排 API ──

  /** 起一个 workflow：从 phase0 开跑（status 默认 running）。 */
  async startWorkflow(workflowId: string): Promise<void> {
    await this.enqueuePhase(workflowId, "phase0_init", 1);
    await this.emit(workflowId, "workflow-status-changed", { phase: "phase0_init", status: "running" });
  }

  /** 审批通过 → 继续下一 phase。CAS 输 → 409。 */
  async approve(workflowId: string): Promise<{ done: boolean; next: PhaseId | null }> {
    const wf = await this.getWorkflow(workflowId);
    const won = await approveCAS(this.db, workflowId);
    if (!won) throw new CheckpointConflictError(`approve 失败：workflow ${workflowId} 非 paused_for_approval`);
    await this.emit(workflowId, "workflow-status-changed", { phase: wf.currentPhase, status: "approved" });

    const next = resolveNextPhase(wf.currentPhase, "continue");
    if (next === null) {
      await this.emit(workflowId, "workflow-completed", { phase: wf.currentPhase });
      return { done: true, next: null };
    }
    await resumeRunning(this.db, workflowId, next);
    await this.enqueuePhase(workflowId, next, 1);
    return { done: false, next };
  }

  /** 重跑当前 phase（新 attempt）。CAS 输 → 409。 */
  async redo(workflowId: string): Promise<void> {
    const wf = await this.getWorkflow(workflowId);
    const won = await claimCheckpointToRunning(this.db, workflowId);
    if (!won) throw new CheckpointConflictError(`redo 失败：workflow ${workflowId} 非 paused_for_approval`);
    const attempt = await nextAttemptNumber(this.db, workflowId, wf.currentPhase);
    await this.enqueuePhase(workflowId, wf.currentPhase, attempt);
  }

  /** 补研究：回 Phase 2 重跑（新 attempt）。CAS 输 → 409。 */
  async augment(workflowId: string): Promise<void> {
    const won = await claimCheckpointToRunning(this.db, workflowId);
    if (!won) throw new CheckpointConflictError(`augment 失败：workflow ${workflowId} 非 paused_for_approval`);
    const target: PhaseId = "phase2_research";
    const attempt = await nextAttemptNumber(this.db, workflowId, target);
    await resumeRunning(this.db, workflowId, target);
    await this.enqueuePhase(workflowId, target, attempt);
  }

  /** 拒绝。CAS 输 → 409。 */
  async reject(workflowId: string): Promise<void> {
    const wf = await this.getWorkflow(workflowId);
    const won = await rejectCAS(this.db, workflowId);
    if (!won) throw new CheckpointConflictError(`reject 失败：workflow ${workflowId} 非 paused_for_approval`);
    await this.emit(workflowId, "workflow-status-changed", { phase: wf.currentPhase, status: "rejected" });
  }

  /**
   * 扫描失联 attempt 并恢复（boot 兜底 + 运行期轮询都可调）。
   * 多 worker 并发调用安全：recoverCAS 原子裁单赢家，赢家负责 re-enqueue n+1。
   * 返回成功接管并重排的 phase 数。
   */
  async recoverStalled(): Promise<number> {
    const orphans = await findOrphanAttempts(this.db);
    let recovered = 0;
    for (const o of orphans) {
      const won = await recoverCAS(this.db, { attemptId: o.id, reason: "lease_expired" });
      if (!won) continue; // 别人赢了
      if (!isPhaseId(o.phase)) continue;
      await this.enqueuePhase(o.workflowId, o.phase, o.attemptNumber + 1);
      await this.emit(o.workflowId, "workflow-recovered", {
        phase: o.phase,
        fromAttempt: o.attemptNumber,
        toAttempt: o.attemptNumber + 1,
      });
      recovered++;
    }
    return recovered;
  }

  // ── enqueue ──

  private async enqueuePhase(workflowId: string, phase: PhaseId, attemptNumber: number): Promise<void> {
    const kind = PHASES[phase].kind;
    if (kind === "fanout") {
      const n = await this.resolveResearcherCount(workflowId);
      const children = Array.from({ length: n }, (_, i) => ({
        name: JOB_RESEARCH_CHILD,
        queueName: this.queueName,
        data: { workflowId, phase, role: `researcher-${i + 1}`, childIndex: i + 1 },
        opts: { ignoreDependencyOnFailure: true, attempts: 3, backoff: { type: "fixed", delay: 50 } },
      }));
      await this.flow!.add({
        name: JOB_AGGREGATE,
        queueName: this.queueName,
        data: { workflowId, phase, attemptNumber, childCount: n },
        children,
      });
    } else {
      await this.queue!.add(kind === "serial" ? JOB_SERIAL : JOB_SINGLE, {
        workflowId,
        phase,
        attemptNumber,
      });
    }
  }

  private async resolveResearcherCount(workflowId: string): Promise<number> {
    if (this.researcherCountFn) return this.researcherCountFn(workflowId);
    const res = await this.db.execute(sql`SELECT axes FROM workflows WHERE id = ${workflowId}`);
    const axes = (res as unknown as { rows?: { axes?: unknown }[] }).rows?.[0]?.axes;
    return Array.isArray(axes) && axes.length > 0 ? axes.length : 3;
  }

  // ── worker 处理 ──

  private async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB_RESEARCH_CHILD:
        return this.processResearchChild(job);
      case JOB_AGGREGATE:
        return this.processAggregate(job);
      case JOB_SERIAL:
        return this.processSerial(job);
      case JOB_SINGLE:
      default:
        return this.processSingle(job);
    }
  }

  /** 子 researcher job：失败抛错让 BullMQ 重试/标失败（ignoreDependencyOnFailure 保 aggregator 仍跑）。 */
  private async processResearchChild(job: Job): Promise<unknown> {
    const { workflowId, phase, role, childIndex } = job.data as {
      workflowId: string;
      phase: string;
      role: string;
      childIndex: number;
    };
    const r = await runResearchChild(this.agentRunner, { workflowId, phase, role, task: phase, childIndex });
    if (!r.ok) throw new Error(`researcher ${role} 失败`);
    return r;
  }

  private async processAggregate(job: Job): Promise<unknown> {
    const { workflowId, phase, attemptNumber, childCount } = job.data as {
      workflowId: string;
      phase: PhaseId;
      attemptNumber: number;
      childCount: number;
    };
    return this.withAttempt(job, workflowId, phase, attemptNumber, async () => {
      const valuesMap = await job.getChildrenValues<{ ok: boolean; text: string }>();
      const present = Object.values(valuesMap);
      const missingCount = Math.max(0, childCount - present.length);
      const childValues = [...present, ...Array<null>(missingCount).fill(null)];
      const agg = aggregateResearch(childValues);
      await writeArtifactIdempotent(this.db, {
        workflowId,
        phase,
        type: agg.artifact.type,
        version: attemptNumber,
        body: agg.artifact.body,
        status: agg.artifact.status,
        idempotencyKey: idempotencyKey(workflowId, phase, attemptNumber),
      });
      await this.emit(workflowId, "phase-aggregated", { phase, total: agg.total, missing: agg.missing });
    });
  }

  private async processSingle(job: Job): Promise<unknown> {
    const { workflowId, phase, attemptNumber } = job.data as {
      workflowId: string;
      phase: PhaseId;
      attemptNumber: number;
    };
    return this.withAttempt(job, workflowId, phase, attemptNumber, async () => {
      const { artifact, ok } = await runSinglePhase(this.agentRunner, { workflowId, phase });
      if (!ok) throw new Error(`phase ${phase} agent 失败`);
      await writeArtifactIdempotent(this.db, {
        workflowId,
        phase,
        type: artifact.type,
        version: attemptNumber,
        body: artifact.body,
        status: artifact.status,
        idempotencyKey: idempotencyKey(workflowId, phase, attemptNumber),
      });
    });
  }

  private async processSerial(job: Job): Promise<unknown> {
    const { workflowId, phase, attemptNumber } = job.data as {
      workflowId: string;
      phase: PhaseId;
      attemptNumber: number;
    };
    return this.withAttempt(job, workflowId, phase, attemptNumber, async () => {
      const { artifact, verdict } = await runSerialReview(this.agentRunner, {
        workflowId,
        phase,
        editorCount: this.editorCount,
      });
      await writeArtifactIdempotent(this.db, {
        workflowId,
        phase,
        type: artifact.type,
        version: attemptNumber,
        body: artifact.body,
        status: artifact.status,
        idempotencyKey: idempotencyKey(workflowId, phase, attemptNumber),
      });
      if (verdict.belowThreshold) {
        await this.emit(workflowId, "artifact-below-threshold", { phase, reason: verdict.reason });
      }
    });
  }

  /**
   * attempt 生命周期包裹：lease → markRunning → heartbeat 续期 → 跑 body → complete → checkpoint。
   * recordAttempt 冲突（别人已持有该 attempt）→ 幂等跳过（不重复跑、不重复 checkpoint）。
   */
  private async withAttempt(
    job: Job,
    workflowId: string,
    phase: PhaseId,
    attemptNumber: number,
    body: () => Promise<void>,
  ): Promise<unknown> {
    const owner = `${this.workerId}:${job.id}`;
    const attempt = await recordAttempt(this.db, {
      workflowId,
      phase,
      attemptNumber,
      owner,
      bullmqJobId: String(job.id),
      leaseSeconds: this.leaseSeconds,
    });
    if (!attempt) return { skipped: "attempt-already-owned" };

    await markAttemptRunning(this.db, attempt.id, owner);
    const hb = setInterval(() => {
      void heartbeat(this.db, attempt.id, owner, this.leaseSeconds).catch(() => {});
    }, this.heartbeatSeconds * 1000);
    // setInterval 不阻止进程退出（leak 防护）；attempt 卡死由 recoverStalled 兜底
    if (typeof hb.unref === "function") hb.unref();

    try {
      await body();
      await completeAttempt(this.db, attempt.id, owner);
      await this.checkpoint(workflowId, phase);
      return { ok: true };
    } catch (err) {
      clearInterval(hb);
      await failAttempt(this.db, attempt.id, owner);
      throw err; // 交给 BullMQ 重试策略
    } finally {
      clearInterval(hb);
    }
  }

  /** phase 完成 → 挂起等审批 + 发事件。 */
  private async checkpoint(workflowId: string, phase: PhaseId): Promise<void> {
    await pauseForApproval(this.db, workflowId, phase);
    await this.emit(workflowId, "workflow-status-changed", { phase, status: "paused_for_approval" });
  }

  // ── 辅助 ──

  private async emit(workflowId: string, event: string, data: unknown): Promise<void> {
    await this.buffer.append(this.db, workflowId, event, data);
  }

  private async getWorkflow(workflowId: string): Promise<WorkflowRow> {
    const res = await this.db.execute(sql`
      SELECT status, current_phase AS "currentPhase" FROM workflows WHERE id = ${workflowId}
    `);
    const row = (res as unknown as { rows?: WorkflowRow[] }).rows?.[0];
    if (!row) throw new Error(`workflow ${workflowId} 不存在`);
    return row;
  }
}
