import React, { useEffect, useMemo, useState } from 'react'

function useEntries(pageSize = 10) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], page: 1, pageSize, total: 0, pages: 1 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async (nextPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/entries?page=${nextPage}&pageSize=${pageSize}`)
      const j = await r.json()
      setData(j)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1) }, [])

  return { data, page, setPage, load, loading, error }
}

export default function App() {
  const pageSize = 10
  const { data, page, setPage, load, loading } = useEntries(pageSize)

  const [storeValue, setStoreValue] = useState('')
  const [storeDesc, setStoreDesc] = useState('')
  const [storeResult, setStoreResult] = useState(null)
  const [sumFrom, setSumFrom] = useState('')
  const [sumTo, setSumTo] = useState('')
  const [sumResult, setSumResult] = useState(null)

  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatMessages, setChatMessages] = useState([])

  const pages = useMemo(() => data.pages || 1, [data.pages])

  const doStore = async (e) => {
    e?.preventDefault()
    const value = parseInt(storeValue, 10)
    if (Number.isNaN(value)) {
      alert('Value must be an integer')
      return
    }
    const description = storeDesc.trim()
    if (!description) {
      alert('Description is required')
      return
    }
    const r = await fetch('/api/tools/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, description })
    })
    const j = await r.json()
    setStoreResult(j)
    await load(page)
  }

  const doSum = async (e) => {
    e?.preventDefault()
    const from = sumFrom.trim()
    const to = sumTo.trim()
    if (!from || !to) {
      alert('Provide from and to (ISO datetime)')
      return
    }
    const r = await fetch(`/api/tools/sum?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    const j = await r.json()
    setSumResult(j)
  }

  const goto = async (p) => {
    const clamped = Math.max(1, Math.min(pages, p))
    setPage(clamped)
    await fetch(`/api/entries?page=${clamped}&pageSize=${pageSize}`)
      .then(r => r.json())
      .then(j => {
        // quick set to avoid flicker
        // eslint-disable-next-line no-undef
        //
      })
    await load(clamped)
  }

  const sendChat = async (e) => {
    e?.preventDefault()
    const content = chatInput.trim()
    if (!content) return
    setChatLoading(true)
    const next = [...chatMessages, { role: 'user', content }]
    setChatMessages(next)
    setChatInput('')
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next })
      })
      const j = await r.json()
      if (j?.role === 'assistant') {
        setChatMessages([...next, { role: 'assistant', content: j.content || '' }])
      } else if (j?.error) {
        setChatMessages([...next, { role: 'assistant', content: `Error: ${j.error}` }])
      }
    } catch (err) {
      setChatMessages([...next, { role: 'assistant', content: `Request failed: ${String(err)}` }])
    } finally {
      setChatLoading(false)
    }
  }

  useEffect(() => {
    // initialize default date range to last 24h
    const now = new Date()
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    setSumTo(now.toISOString())
    setSumFrom(y.toISOString())
  }, [])

  return (
    <div className="container py-4">
      <h2 className="h3 mb-3">MCP SQLite Store/Sum</h2>

      <section className="card mb-3">
        <div className="card-body">
          <h3 className="h5 card-title mb-3">Chat</h3>
          <form onSubmit={sendChat} className="d-flex flex-wrap gap-2 align-items-center mb-2">
            <input
              type="text"
              placeholder="Ask with tools..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="form-control flex-grow-1"
            />
            <button type="submit" className="btn btn-primary" disabled={chatLoading}>
              {chatLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
          <div className="bg-body-secondary p-3 rounded small" style={{ whiteSpace: 'pre-wrap', minHeight: '80px' }}>
            {chatMessages.length === 0 ? (
              <span className="text-body-secondary">No messages yet</span>
            ) : (
              chatMessages.map((m, i) => (
                <div key={i} className="mb-2">
                  <strong>{m.role}:</strong> {m.content}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="card mb-3">
        <div className="card-body">
          <h3 className="h5 card-title mb-3">Store tool</h3>
          <form onSubmit={doStore} className="d-flex flex-wrap gap-2 align-items-center">
            <input
              type="number"
              placeholder="value (int)"
              value={storeValue}
              onChange={(e) => setStoreValue(e.target.value)}
              className="form-control"
              style={{ width: '140px' }}
            />
            <input
              type="text"
              placeholder="description"
              value={storeDesc}
              onChange={(e) => setStoreDesc(e.target.value)}
              className="form-control flex-grow-1"
              style={{ minWidth: '220px' }}
            />
            <button type="submit" className="btn btn-primary">Store</button>
          </form>
          {storeResult && (
            <pre className="bg-body-secondary p-3 rounded mt-3 mb-0 small" style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(storeResult, null, 2)}
            </pre>
          )}
        </div>
      </section>

      <section className="card mb-3">
        <div className="card-body">
          <h3 className="h5 card-title mb-3">Sum tool</h3>
          <form onSubmit={doSum} className="d-flex flex-wrap gap-2 align-items-center">
            <input
              type="text"
              placeholder="from (ISO)"
              value={sumFrom}
              onChange={(e) => setSumFrom(e.target.value)}
              className="form-control"
              style={{ minWidth: '260px' }}
            />
            <input
              type="text"
              placeholder="to (ISO)"
              value={sumTo}
              onChange={(e) => setSumTo(e.target.value)}
              className="form-control"
              style={{ minWidth: '260px' }}
            />
            <button type="submit" className="btn btn-primary">Sum</button>
          </form>
          {sumResult && (
            <pre className="bg-body-secondary p-3 rounded mt-3 mb-0 small" style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(sumResult, null, 2)}
            </pre>
          )}
        </div>
      </section>

      <section className="card mb-3">
        <div className="card-body">
          <h3 className="h5 card-title">Entries</h3>
          {loading ? (
            <div className="text-body-secondary">Loading...</div>
          ) : (
            <>
              <div className="table-responsive mt-2">
                <table className="table table-striped table-hover align-middle">
                  <thead>
                    <tr>
                      <th scope="col" className="text-start">ID</th>
                      <th scope="col" className="text-start">Value</th>
                      <th scope="col" className="text-start">Description</th>
                      <th scope="col" className="text-start">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.id}>
                        <td className="py-2">{it.id}</td>
                        <td className="py-2">{it.value}</td>
                        <td className="py-2">{it.description}</td>
                        <td className="py-2">{new Date(it.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="d-flex align-items-center gap-2 mt-2">
                <div className="btn-group" role="group" aria-label="Pagination">
                  <button onClick={() => goto(1)} disabled={page <= 1} className="btn btn-outline-light btn-sm">First</button>
                  <button onClick={() => goto(page - 1)} disabled={page <= 1} className="btn btn-outline-light btn-sm">Prev</button>
                  <button onClick={() => goto(page + 1)} disabled={page >= pages} className="btn btn-outline-light btn-sm">Next</button>
                  <button onClick={() => goto(pages)} disabled={page >= pages} className="btn btn-outline-light btn-sm">Last</button>
                </div>
                <span className="ms-2 small">Page {data.page} / {pages}</span>
              </div>
            </>
          )}
        </div>
      </section>

      <p className="text-secondary mt-3">
        MCP SSE URL to test with Inspector: <code>http://localhost:4444/sse</code>
      </p>
    </div>
  )
} 