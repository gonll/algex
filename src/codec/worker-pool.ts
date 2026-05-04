// Thread pool for parallel chunk encoding.
// Each worker handles one chunk at a time; idle workers pick from the queue.
//
// Workers need the tsx loader to run TypeScript directly.  We inherit execArgv
// from the parent process (which tsx already loaded) so workers resolve imports
// the same way.

import { Worker }              from "worker_threads"
import { availableParallelism } from "os"
import { join }                from "path"

// Use a plain CJS shim that registers tsx before loading the TypeScript worker.
// This avoids relying on inheriting --import/--require flags via execArgv.
const WORKER_FILE = join(__dirname, "worker-shim.cjs")

type Resolve = (buf: ArrayBuffer) => void
interface Task { id: number; buffer: ArrayBuffer; resolve: Resolve }

export class WorkerPool {
  private readonly workers: Worker[] = []
  private readonly idle:    Worker[] = []
  private readonly queue:   Task[]   = []
  private readonly pending  = new Map<number, Task>()
  private nextId = 0

  constructor(size = availableParallelism()) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(WORKER_FILE)
      w.on("message", ({ id, serialized }: { id: number; serialized: ArrayBuffer }) => {
        const task = this.pending.get(id)!
        this.pending.delete(id)
        task.resolve(serialized)
        this.idle.push(w)
        this.dispatch()
      })
      w.on("error", (err) => { throw err })
      this.idle.push(w)
      this.workers.push(w)
    }
  }

  encode(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>(resolve => {
      this.queue.push({ id: this.nextId++, buffer, resolve })
      this.dispatch()
    })
  }

  private dispatch() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!
      const task   = this.queue.shift()!
      this.pending.set(task.id, task)
      worker.postMessage({ id: task.id, buffer: task.buffer }, [task.buffer])
    }
  }

  terminate(): Promise<void> {
    return Promise.all(this.workers.map(w => w.terminate())).then(() => undefined)
  }
}
