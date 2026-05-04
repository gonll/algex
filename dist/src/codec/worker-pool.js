"use strict";
// Thread pool for parallel chunk encoding.
// Each worker handles one chunk at a time; idle workers pick from the queue.
//
// Workers need the tsx loader to run TypeScript directly.  We inherit execArgv
// from the parent process (which tsx already loaded) so workers resolve imports
// the same way.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerPool = void 0;
const worker_threads_1 = require("worker_threads");
const os_1 = require("os");
const path_1 = require("path");
// Use a plain CJS shim that registers tsx before loading the TypeScript worker.
// This avoids relying on inheriting --import/--require flags via execArgv.
const WORKER_FILE = (0, path_1.join)(__dirname, "worker-shim.cjs");
class WorkerPool {
    workers = [];
    idle = [];
    queue = [];
    pending = new Map();
    nextId = 0;
    constructor(size = (0, os_1.availableParallelism)()) {
        for (let i = 0; i < size; i++) {
            const w = new worker_threads_1.Worker(WORKER_FILE);
            w.on("message", ({ id, serialized }) => {
                const task = this.pending.get(id);
                this.pending.delete(id);
                task.resolve(serialized);
                this.idle.push(w);
                this.dispatch();
            });
            w.on("error", (err) => { throw err; });
            this.idle.push(w);
            this.workers.push(w);
        }
    }
    encode(buffer) {
        return new Promise(resolve => {
            this.queue.push({ id: this.nextId++, buffer, resolve });
            this.dispatch();
        });
    }
    dispatch() {
        while (this.idle.length > 0 && this.queue.length > 0) {
            const worker = this.idle.pop();
            const task = this.queue.shift();
            this.pending.set(task.id, task);
            worker.postMessage({ id: task.id, buffer: task.buffer }, [task.buffer]);
        }
    }
    terminate() {
        return Promise.all(this.workers.map(w => w.terminate())).then(() => undefined);
    }
}
exports.WorkerPool = WorkerPool;
