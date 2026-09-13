interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type D1Result<T = Record<string, unknown>> = {
  results?: T[];
  success: boolean;
};

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2Object {
  key: string;
  customMetadata?: Record<string, string>;
}

interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

interface R2Bucket {
  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
  ): Promise<R2MultipartUpload>;
  head(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: {
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2Object | null>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
  delete(keys: string | string[]): Promise<void>;
}

interface R2UploadedPart {
  partNumber: number;
  etag: string;
}

interface R2MultipartUpload {
  uploadPart(partNumber: number, value: ArrayBufferView): Promise<R2UploadedPart>;
  complete(parts: R2UploadedPart[]): Promise<R2Object>;
  abort(): Promise<void>;
}

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
