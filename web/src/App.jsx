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

  useEffect(() => {
    // initialize default date range to last 24h
    const now = new Date()
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    setSumTo(now.toISOString())
    setSumFrom(y.toISOString())
  }, [])

  return (
    <div style={{ maxWidth: 900, margin: '20px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h2>MCP SQLite Store/Sum</h2>

      <section style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3>Store tool</h3>
        <form onSubmit={doStore} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" placeholder="value (int)" value={storeValue} onChange={(e) => setStoreValue(e.target.value)} />
          <input type="text" placeholder="description" value={storeDesc} onChange={(e) => setStoreDesc(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button type="submit">Store</button>
        </form>
        {storeResult && (
          <pre style={{ background: '#f7f7f7', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>{JSON.stringify(storeResult, null, 2)}</pre>
        )}
      </section>

      <section style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3>Sum tool</h3>
        <form onSubmit={doSum} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" placeholder="from (ISO)" value={sumFrom} onChange={(e) => setSumFrom(e.target.value)} style={{ minWidth: 260 }} />
          <input type="text" placeholder="to (ISO)" value={sumTo} onChange={(e) => setSumTo(e.target.value)} style={{ minWidth: 260 }} />
          <button type="submit">Sum</button>
        </form>
        {sumResult && (
          <pre style={{ background: '#f7f7f7', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>{JSON.stringify(sumResult, null, 2)}</pre>
        )}
      </section>

      <section style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3>Entries</h3>
        {loading ? <div>Loading...</div> : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>ID</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Value</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Description</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 6, borderBottom: '1px solid #f0f0f0' }}>{it.id}</td>
                    <td style={{ padding: 6, borderBottom: '1px solid #f0f0f0' }}>{it.value}</td>
                    <td style={{ padding: 6, borderBottom: '1px solid #f0f0f0' }}>{it.description}</td>
                    <td style={{ padding: 6, borderBottom: '1px solid #f0f0f0' }}>{new Date(it.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <button onClick={() => goto(1)} disabled={page <= 1}>First</button>
              <button onClick={() => goto(page - 1)} disabled={page <= 1}>Prev</button>
              <span>Page {data.page} / {pages}</span>
              <button onClick={() => goto(page + 1)} disabled={page >= pages}>Next</button>
              <button onClick={() => goto(pages)} disabled={page >= pages}>Last</button>
            </div>
          </>
        )}
      </section>

      <p style={{ marginTop: 20, color: '#666' }}>
        MCP SSE URL to test with Inspector: <code>http://localhost:4444/sse</code>
      </p>
    </div>
  )
} 