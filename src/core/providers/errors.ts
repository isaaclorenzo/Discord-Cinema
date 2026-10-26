// Traduce errores típicos de los proveedores a una explicación accionable.

export interface ErrorHint {
  title: string
  hint: string
  /** El problema está en la cuenta o configuración, no en la harness. */
  accountIssue?: boolean
}

export function explainProviderError(message: string): ErrorHint {
  const status = Number(message.match(/respondió (\d{3})/)?.[1] ?? 0)
  const m = message.toLowerCase()
  if (/webgpu/.test(m)) return { title: 'Modelo local no disponible', hint: 'Este equipo o navegador no puede ejecutar el modelo local. Usa Chrome o Edge actualizados en un ordenador con GPU, o elige un modelo más pequeño (Qwen3 0.6B, Llama 3.2 1B).' }
  if (/modelo local|espacio en el navegador|descargar el modelo/.test(m)) return { title: 'Problema con el modelo local', hint: 'Revisa el detalle: puede faltar espacio en disco, conexión para la primera descarga o memoria de GPU. Un modelo más pequeño suele funcionar.' }
  if (/certificado no es válido/.test(m)) {
    return { title: 'Conexión segura rechazada', hint: 'El certificado del proveedor no superó la verificación dentro del navegador, así que no se envió nada (ni tu clave ni tus mensajes). Puede ser un servidor de túnel malicioso o un proveedor mal configurado: cambia de servidor de túnel en Seguridad o revisa la URL del proveedor.' }
  }
  if (/por el túnel cifrado|cargar el túnel|el túnel no se conecta/.test(m)) {
    return { title: 'El túnel cifrado no respondió', hint: 'No se pudo abrir el túnel hacia el proveedor (el servidor del túnel puede estar caído o bloqueado en tu red). Pulsa Reintentar, prueba otro servidor en Seguridad → Túnel cifrado, o usa un proveedor que admita llamadas directas (Google Gemini, OpenRouter).' }
  }
  if (/cors|failed to fetch|networkerror|load failed/.test(m)) {
    return { title: 'No se pudo conectar', hint: 'El navegador no pudo llegar al proveedor (suele ser CORS). Activa el túnel cifrado en Seguridad o cambia la conexión del proveedor a «Túnel cifrado» en Proveedores.' }
  }
  if (/no hay relay/.test(m)) return { title: 'Sin relay', hint: 'Este despliegue no tiene relay. Activa el túnel cifrado en Seguridad, cambia el proveedor a «Directa» o configura un relay propio.' }
  if (/context|too long|maximum.*tokens|token limit/.test(m)) {
    return { title: 'Conversación demasiado larga', hint: 'Supera la ventana de contexto del modelo. Usa /compact o empieza una conversación nueva.' }
  }
  if (status === 400 && /tool|function/.test(m)) {
    return { title: 'El modelo no acepta herramientas', hint: 'En Proveedores, abre la ficha del modelo y cambia «Herramientas» a «Por prompt» (o «Sin herramientas»).' }
  }
  switch (true) {
    case status === 401 || status === 403 || /api[ _-]?key (is )?(not valid|invalid)|valid api key|invalid api key|incorrect api key|invalid_api_key/.test(m):
      return { title: 'Clave rechazada', hint: 'La clave de API no es válida o no tiene permiso para este modelo. Revísala en Proveedores.', accountIssue: true }
    case status === 402 || /credit|billing|balance|insufficient|saldo|quota|free models/.test(m):
      return { title: 'Tu cuenta del proveedor no tiene acceso', hint: 'El proveedor limita tu cuenta (créditos, cuota o requisitos del plan gratuito). Sigue sus indicaciones (añadir créditos, verificar la cuenta…) o elige otro modelo en el selector.', accountIssue: true }
    case status === 404:
      return { title: 'Modelo o URL no encontrados', hint: 'Comprueba la URL base y el id del modelo. En Proveedores, «Cargar modelos» trae la lista real.', accountIssue: true }
    case status === 429:
      return { title: 'Límite de peticiones', hint: 'El proveedor está limitando las peticiones. Espera unos segundos y pulsa Reintentar, o cambia de modelo.' }
    case status >= 500:
      return { title: 'Fallo temporal del proveedor', hint: 'El servidor del proveedor falló. Suele resolverse reintentando en un momento.' }
    default:
      return { title: 'Error del proveedor', hint: 'Revisa la configuración del proveedor; el detalle técnico está debajo.' }
  }
}
