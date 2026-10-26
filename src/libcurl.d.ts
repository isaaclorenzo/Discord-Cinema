// Tipos mínimos de libcurl.js (el paquete no trae declaraciones).
declare module 'libcurl.js' {
  export interface HttpSession {
    fetch(url: string, init?: RequestInit): Promise<Response>
    close(): void
  }
  export interface LibcurlApi {
    HTTPSession: new (options?: { enable_cookies?: boolean; proxy?: string }) => HttpSession
    load_wasm(url?: string): Promise<void>
    set_websocket(url: string): void
    fetch(url: string, init?: RequestInit & { _libcurl_http_version?: number }): Promise<Response>
    transport: string | unknown
    stdout: (text: string) => void
    stderr: (text: string) => void
    logger: (type: 'log' | 'warn' | 'error', text: string) => void
    readonly ready: boolean
  }
  export const libcurl: LibcurlApi
}
