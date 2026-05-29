// Backend communication.

export async function uploadCsv(file) {
  const form = new FormData()
  form.append('file', file)

  const resp = await fetch('/api/upload', {
    method: 'POST',
    body: form,
  })

  if (!resp.ok) {
    let detail = `Upload failed (HTTP ${resp.status})`
    try {
      const body = await resp.json()
      if (body && body.detail) detail = body.detail
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(detail)
  }

  return resp.json()
}
