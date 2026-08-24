interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type D1Database = object;

declare module "cloudflare:sockets" {
  export type SocketAddress = { hostname: string; port: number };
  export type SocketOptions = {
    secureTransport?: "off" | "on" | "starttls";
    allowHalfOpen?: boolean;
  };
  export type SocketInfo = {
    remoteAddress: string | null;
    localAddress: string | null;
  };
  export interface Socket {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    readonly opened: Promise<SocketInfo>;
    readonly closed: Promise<void>;
    close(): Promise<void>;
    startTls(): Socket;
  }
  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket;
}

declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
