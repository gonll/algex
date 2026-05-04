export declare class WorkerPool {
    private readonly workers;
    private readonly idle;
    private readonly queue;
    private readonly pending;
    private nextId;
    constructor(size?: number);
    encode(buffer: ArrayBuffer): Promise<ArrayBuffer>;
    private dispatch;
    terminate(): Promise<void>;
}
