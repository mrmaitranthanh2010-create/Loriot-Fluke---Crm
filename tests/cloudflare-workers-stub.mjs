export class DurableObject {
  constructor(ctx = {}, env = {}) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}

const workerExports = {};
export { workerExports as exports };
