// Worker que ejecuta los modelos locales de WebLLM (WebGPU) fuera del hilo principal.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg)
