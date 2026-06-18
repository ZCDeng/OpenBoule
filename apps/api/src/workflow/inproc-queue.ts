/**
 * 进程内工作流队列（macOS app 化 / 本地零基础设施）。
 *
 * 复刻 engine.ts 实际用到的 BullMQ 子集，免 Redis：
 *   - 单队列多 job 名（靠 job.name 分派）
 *   - 并发上限（workerConcurrency）
 *   - FlowProducer parent-child fan-out（children 全部结算后才跑 parent；parent 经 getChildrenValues 取成功子值）
 *   - 每 job 重试（attempts + fixed backoff delay）
 *   - ignoreDependencyOnFailure（子失败不阻塞 parent，仅缺其值）
 *
 * 不做（单进程不需要）：跨进程 BRPOPLPUSH、lease/heartbeat、stalled recovery。失联恢复在单进程里不会发生；
 * engine.recoverStalled 仍可调（扫 DB orphan），正常单进程跑不会有 orphan，是无害安全网。
 *
 * 共享语义：Queue / FlowProducer / Worker 用同一 queueName 经 broker 注册表汇合（等价 BullMQ 同 Redis+同队列名）。
 * 对外只暴露 engine 用到的表面（add / close / job.name|id|data|getChildrenValues），由 queues.ts 强转成 BullMQ 类型。
 */

export class InprocJob {
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
  /** parent job 专用：成功子 job 的返回值，键为子 job id（仅值被 engine 消费）。 */
  childrenValues: Record<string, unknown> = {};

  constructor(id: string, name: string, data: unknown) {
    this.id = id;
    this.name = name;
    this.data = data;
  }

  async getChildrenValues<T = unknown>(): Promise<Record<string, T>> {
    return this.childrenValues as Record<string, T>;
  }
}

type Processor = (job: InprocJob) => Promise<unknown>;

interface JobOpts {
  ignoreDependencyOnFailure?: boolean;
  attempts?: number;
  backoff?: { type: string; delay: number };
}

interface Task {
  job: InprocJob;
  opts: JobOpts;
  onSettled?: (ok: boolean, value: unknown) => void;
}

/** 单队列调度器：注册一个 processor，按并发上限消费 job，带重试。 */
class Broker {
  private processor?: Processor;
  private concurrency = 4;
  private active = 0;
  private readonly waiting: Task[] = [];
  private seq = 0;
  private closed = false;

  nextId(): string {
    return String(++this.seq);
  }

  setProcessor(p: Processor, concurrency: number): void {
    this.processor = p;
    this.concurrency = Math.max(1, concurrency);
    this.drain();
  }

  enqueue(task: Task): void {
    if (this.closed) return;
    this.waiting.push(task);
    this.drain();
  }

  private drain(): void {
    if (this.closed || !this.processor) return;
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      this.active++;
      void this.run(task).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }

  private async run(task: Task): Promise<void> {
    const attempts = Math.max(1, task.opts.attempts ?? 1);
    const delay = task.opts.backoff?.delay ?? 0;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const value = await this.processor!(task.job);
        task.onSettled?.(true, value);
        return;
      } catch {
        // BullMQ 里失败 job 不会拖垮 worker；重试耗尽则标失败、继续下一个。
        if (attempt < attempts && delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    task.onSettled?.(false, undefined);
  }

  close(): void {
    this.closed = true;
    this.waiting.length = 0;
  }
}

const brokers = new Map<string, Broker>();
function broker(queueName: string): Broker {
  let b = brokers.get(queueName);
  if (!b) {
    b = new Broker();
    brokers.set(queueName, b);
  }
  return b;
}

/** Queue 表面：engine 用 add(name, data) + close()。 */
export class InprocQueue {
  private readonly queueName: string;
  constructor(queueName: string) {
    this.queueName = queueName;
  }
  async add(name: string, data: unknown): Promise<InprocJob> {
    const b = broker(this.queueName);
    const job = new InprocJob(b.nextId(), name, data);
    b.enqueue({ job, opts: {} });
    return job;
  }
  async close(): Promise<void> {
    /* worker.close 负责停 broker */
  }
}

interface FlowChild {
  name: string;
  queueName?: string;
  data: unknown;
  opts?: JobOpts;
}
interface FlowNode {
  name: string;
  queueName?: string;
  data: unknown;
  children?: FlowChild[];
}

/** FlowProducer 表面：engine 用 add({name, queueName, data, children}) + close()。 */
export class InprocFlowProducer {
  private readonly defaultQueue: string;
  constructor(defaultQueue: string) {
    this.defaultQueue = defaultQueue;
  }
  async add(node: FlowNode): Promise<InprocJob> {
    const parentQueue = node.queueName ?? this.defaultQueue;
    const pb = broker(parentQueue);
    const parent = new InprocJob(pb.nextId(), node.name, node.data);
    const children = node.children ?? [];

    if (children.length === 0) {
      pb.enqueue({ job: parent, opts: {} });
      return parent;
    }

    // 所有子 job 结算（成功或失败-but-ignored）后，才入队 parent（waiting-children 语义）。
    let remaining = children.length;
    const settleOne = () => {
      remaining -= 1;
      if (remaining === 0) pb.enqueue({ job: parent, opts: {} });
    };

    for (const child of children) {
      const cb = broker(child.queueName ?? parentQueue);
      const cjob = new InprocJob(cb.nextId(), child.name, child.data);
      const opts = child.opts ?? {};
      cb.enqueue({
        job: cjob,
        opts,
        onSettled: (ok, value) => {
          // 成功 → 收子返回值供 parent 聚合；失败 → ignoreDependencyOnFailure 时仅缺其值。
          if (ok) parent.childrenValues[cjob.id] = value;
          settleOne();
        },
      });
    }
    return parent;
  }
  async close(): Promise<void> {
    /* no-op */
  }
}

/** Worker 表面：构造即把 processor 注册到 broker；close 停队列。 */
export class InprocWorker {
  private readonly queueName: string;
  constructor(queueName: string, processor: Processor, concurrency: number) {
    this.queueName = queueName;
    broker(queueName).setProcessor(processor, concurrency);
  }
  async close(): Promise<void> {
    broker(this.queueName).close();
    brokers.delete(this.queueName);
  }
}

/** 假连接：engine close 时调 .quit()，inproc 无真连接，no-op。 */
export function makeInprocConnection(): { quit: () => Promise<void> } {
  return { quit: async () => {} };
}
