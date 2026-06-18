/**
 * BullMQ 队列基建（U4）。
 *
 * 一处收口 Redis 连接 + 队列/Worker/FlowProducer 工厂——engine 与 phase worker 都从这里取，
 * 不各自 new Redis（连接散落 = 关不干净 = 测试挂起）。BullMQ 与安全集(nonce/lock)分逻辑 DB（KTD-19）。
 *
 * 连接生命周期：createConnection 出来的 ioredis 实例由调用方负责 quit()（engine.close 收口）。
 * BullMQ 要求 maxRetriesPerRequest=null（阻塞命令 BRPOPLPUSH 不能被重试打断）。
 */

import { Queue, Worker, FlowProducer, type Processor, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.ts";
import { InprocQueue, InprocFlowProducer, InprocWorker, makeInprocConnection } from "./inproc-queue.ts";

/** 单一队列名——所有 phase job 走一条队，靠 job.name 区分 phase（fan-out 子 job 同队）。 */
export const PHASE_QUEUE = "boule-phase";

/** inproc 驱动（本地 app）：进程内队列替 BullMQ/Redis；engine 表面不变，由此处强转回 BullMQ 类型。 */
const INPROC = config.queueDriver === "inproc";

/** 新建一条队列连接：bullmq=Redis（bullmqDb），inproc=假连接（quit no-op）。调用方负责 quit()。 */
export function createConnection(): Redis {
  if (INPROC) return makeInprocConnection() as unknown as Redis;
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.bullmqDb,
    // BullMQ 硬性要求：阻塞命令不可被 per-request 重试中断
    maxRetriesPerRequest: null,
  });
}

/** 用一条已有连接包出 BullMQ ConnectionOptions（复用连接，避免每个原语各开一条）。 */
function asConnection(conn: Redis): ConnectionOptions {
  return conn as unknown as ConnectionOptions;
}

export function makeQueue(conn: Redis, queueName = PHASE_QUEUE): Queue {
  if (INPROC) return new InprocQueue(queueName) as unknown as Queue;
  return new Queue(queueName, { connection: asConnection(conn) });
}

export function makeFlowProducer(conn: Redis): FlowProducer {
  if (INPROC) return new InprocFlowProducer(PHASE_QUEUE) as unknown as FlowProducer;
  return new FlowProducer({ connection: asConnection(conn) });
}

export function makeWorker(conn: Redis, processor: Processor, concurrency = 4, queueName = PHASE_QUEUE): Worker {
  if (INPROC) {
    const inprocProcessor = processor as unknown as ConstructorParameters<typeof InprocWorker>[1];
    return new InprocWorker(queueName, inprocProcessor, concurrency) as unknown as Worker;
  }
  return new Worker(queueName, processor, {
    connection: asConnection(conn),
    concurrency,
  });
}
