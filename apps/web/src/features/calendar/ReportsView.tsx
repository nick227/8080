import { useLayoutEffect, useRef, useState } from 'react'
import { useTaskReport, type TaskReport } from '@project/sdk'
import type { Filters } from './store'

// Board reports. Forms follow the data's job: headline numbers are stat tiles;
// throughput is a single-series column chart; cycle time is two lines on one axis
// (same unit); cumulative flow is a stacked area by category. Every chart has a
// hover/focus readout and a table view (light-theme slots 2–3 sit under 3:1, so the
// legend + table are the required relief). Colors are validated slots (dataviz).

const RANGES = [4, 8, 12] as const
const PLOT_H = 180
const AXIS_W = 36
const AXIS_H = 22

function shortDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function duration(hours: number | null) {
  if (hours == null) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`
  return `${Math.round((hours / 24) * 10) / 10} d`
}

/** Clean round ticks from 0 to just above max. */
function ticks(max: number, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100)
  if (out.at(-1)! < max) out.push(Math.round((out.at(-1)! + step) * 100) / 100)
  return out
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

export function ReportsView({ workspaceId, filters }: { workspaceId: string; filters: Filters }) {
  const [weeks, setWeeks] = useState<number>(8)
  const query = useTaskReport(workspaceId, weeks, {
    who: filters.members.join(','),
    type: filters.types.join(','),
    area: filters.areas.join(','),
    priority: filters.priorities.join(','),
    q: filters.search.trim(),
  })
  const r = query.data
  return (
    <div className="cal-reports" data-loading={query.isFetching || undefined}>
      <div className="cal-reports-filters" role="group" aria-label="Date range">
        {RANGES.map((w) => (
          <button key={w} type="button" className="cal-urgency-chip" aria-pressed={weeks === w} onClick={() => setWeeks(w)}>Last {w} weeks</button>
        ))}
        <span className="cal-view-count">{r?.filtered ? 'Filtered tasks, by their current fields' : 'Whole workspace'}{r ? ` · ${r.range.timezone}` : ''}</span>
      </div>
      {query.isError && <p className="cal-board-note" role="alert">Reports couldn't load. <button type="button" className="cal-link-btn" onClick={() => void query.refetch()}>Retry</button></p>}
      {!r ? <p className="cal-board-note" role="status">Loading reports…</p> : (
        <>
          <Tiles r={r} />
          <div className="cal-reports-grid">
            <Throughput r={r} />
            <CycleTime r={r} />
            <Flow r={r} />
            <People r={r} />
            <Hours r={r} />
          </div>
        </>
      )}
    </div>
  )
}

function Tiles({ r }: { r: TaskReport }) {
  const delta = r.done.thisPeriod - r.done.previousPeriod
  const tiles: { label: string; value: string; note?: string }[] = [
    { label: 'Done', value: String(r.done.thisPeriod), note: `${delta === 0 ? 'same as' : delta > 0 ? `+${delta} vs` : `${delta} vs`} previous ${r.range.weeks} weeks` },
    { label: 'In progress', value: String(r.now.doing) },
    { label: 'To do', value: String(r.now.todo) },
    { label: 'Median cycle time', value: duration(r.cycleTime.medianHours), note: r.cycleTime.samples ? `85% within ${duration(r.cycleTime.p85Hours)}` : 'nothing finished yet' },
    { label: 'Overdue', value: String(r.now.overdue) },
    { label: 'Blocked', value: String(r.now.blocked) },
    { label: 'Due this week', value: String(r.now.dueWeek) },
    { label: 'Hours logged', value: hoursText(r.hours.total), note: `last ${r.range.weeks} weeks` },
  ]
  return (
    <ul className="cal-tiles" aria-label="Summary">
      {tiles.map((t) => (
        <li key={t.label} className="cal-tile">
          <span className="cal-tile-label">{t.label}</span>
          <span className="cal-tile-value">{t.value}</span>
          {t.note && <span className="cal-tile-note">{t.note}</span>}
        </li>
      ))}
    </ul>
  )
}

/** A chart card with a title, the chart or its table, and the toggle between them. */
function Card({ title, sub, table, children, legend }: { title: string; sub?: string; table: React.ReactNode; children: React.ReactNode; legend?: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className="cal-chart-card" aria-label={title}>
      <header>
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <button type="button" className="cal-link-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? 'Chart' : 'Table'}</button>
      </header>
      {!asTable && legend}
      {asTable ? <div className="cal-chart-table">{table}</div> : children}
    </section>
  )
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(0, x + 12), width - 150)
  return <div className="cal-viz-tip" role="status" style={{ left, top: Math.max(0, y - 8) }}>{children}</div>
}

function Throughput({ r }: { r: TaskReport }) {
  const data = r.throughput.map((d) => ({ weekStart: d.weekStart, value: d.done }))
  return (
    <Card title="Throughput" sub="Tasks finished per week"
      table={<table><thead><tr><th>Week of</th><th>Done</th></tr></thead><tbody>{data.map((d) => <tr key={d.weekStart}><td>{shortDay(d.weekStart)}</td><td>{d.value}</td></tr>)}</tbody></table>}>
      <WeeklyColumns name="Throughput" data={data} format={(v) => String(v)} unit="done" />
    </Card>
  )
}

const hoursText = (h: number) => `${Math.round(h * 10) / 10} h`

function Hours({ r }: { r: TaskReport }) {
  const data = r.hours.weekly.map((d) => ({ weekStart: d.weekStart, value: d.hours }))
  const people = (
    <table>
      <thead><tr><th>Credited to</th><th>Hours</th></tr></thead>
      <tbody>{r.hours.people.map((p) => <tr key={p.memberId ?? 'team'}><td>{p.name}</td><td>{hoursText(p.hours)}</td></tr>)}</tbody>
    </table>
  )
  return (
    <Card title="Hours logged" sub={r.hours.entries ? `${hoursText(r.hours.total)} from ${r.hours.entries} work ${r.hours.entries === 1 ? 'entry' : 'entries'}` : 'Hours from Log work, per week'}
      table={<>
        <table><thead><tr><th>Week of</th><th>Hours</th></tr></thead><tbody>{data.map((d) => <tr key={d.weekStart}><td>{shortDay(d.weekStart)}</td><td>{hoursText(d.value)}</td></tr>)}</tbody></table>
        {r.hours.people.length > 0 && people}
      </>}>
      {r.hours.entries === 0 ? <p className="cal-board-note">No hours logged in this range. Add hours when you log work.</p> : (
        <>
          <WeeklyColumns name="Hours logged" data={data} format={hoursText} unit="logged" />
          <div className="cal-chart-table cal-hours-people">{people}</div>
        </>
      )}
    </Card>
  )
}

/** One series of weekly columns: thin bars, a label on the latest and the peak, hover/focus readout. */
function WeeklyColumns({ name, data, format, unit }: { name: string; data: { weekStart: string; value: number }[]; format: (v: number) => string; unit: string }) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.value), 1)
  const tk = ticks(max)
  const top = tk.at(-1)!
  const plotW = width - AXIS_W
  const band = plotW / data.length
  const barW = Math.min(24, band * 0.6)
  const y = (v: number) => PLOT_H - (v / top) * PLOT_H
  const maxIdx = data.reduce((m, d, i) => (d.value > data[m]!.value ? i : m), 0)
  return (
    <div ref={ref} className="cal-viz">
      <svg width={width} height={PLOT_H + AXIS_H + 8} role="img" aria-label={`${name}: ${data.map((d) => `${shortDay(d.weekStart)} ${format(d.value)}`).join(', ')}`}>
        <g transform="translate(0,8)">
          {tk.map((v) => (
            <g key={v}>
              <line className="viz-grid" x1={AXIS_W} x2={width} y1={y(v)} y2={y(v)} />
              <text className="viz-axis" x={AXIS_W - 6} y={y(v)} dy="0.32em" textAnchor="end">{v}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = AXIS_W + band * i + band / 2
            const h = PLOT_H - y(d.value)
            const showLabel = d.value > 0 && (i === data.length - 1 || i === maxIdx)
            return (
              <g key={d.weekStart}>
                {h > 0 && <path className="viz-bar" data-hover={hover === i || undefined} d={roundedTop(cx - barW / 2, y(d.value), barW, h, Math.min(4, h))} />}
                {showLabel && <text className="viz-label" x={cx} y={y(d.value) - 6} textAnchor="middle">{format(d.value)}</text>}
                <text className="viz-axis" x={cx} y={PLOT_H + 16} textAnchor="middle">{data.length > 8 && i % 2 ? '' : shortDay(d.weekStart)}</text>
                {/* The hit target is the whole band, not the painted bar. */}
                <rect className="viz-hit" x={AXIS_W + band * i} y={0} width={band} height={PLOT_H} tabIndex={0}
                  aria-label={`Week of ${shortDay(d.weekStart)}: ${format(d.value)} ${unit}`}
                  onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
              </g>
            )
          })}
          <line className="viz-baseline" x1={AXIS_W} x2={width} y1={PLOT_H} y2={PLOT_H} />
        </g>
      </svg>
      {hover !== null && (
        <Tooltip x={AXIS_W + band * hover + band / 2} y={y(data[hover]!.value)} width={width}>
          <strong>{format(data[hover]!.value)}</strong> {unit}<br /><span>Week of {shortDay(data[hover]!.weekStart)}</span>
        </Tooltip>
      )}
    </div>
  )
}

/** A column with a 4px rounded data-end and a square baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

function CycleTime({ r }: { r: TaskReport }) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const data = r.cycleTime.weekly
  const series = [
    { key: 'medianHours' as const, label: 'Median', cls: 'viz-s1' },
    { key: 'p85Hours' as const, label: '85th percentile', cls: 'viz-s2' },
  ]
  const values = data.flatMap((d) => [d.medianHours, d.p85Hours]).filter((v): v is number => v != null)
  const tk = ticks(Math.max(...values, 1))
  const top = tk.at(-1)!
  const plotW = width - AXIS_W - 12
  const x = (i: number) => AXIS_W + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1))
  const y = (v: number) => PLOT_H - (v / top) * PLOT_H
  // Lines break across weeks with nothing finished.
  const path = (k: 'medianHours' | 'p85Hours') => data.reduce((acc, d, i) => {
    const v = d[k]
    if (v == null) return acc
    const prev = i > 0 ? data[i - 1]![k] : null
    return `${acc}${prev == null ? 'M' : 'L'}${x(i)},${y(v)} `
  }, '')
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left
    const i = Math.round(((px) / plotW) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }
  const last = data.length - 1
  return (
    <Card title="Cycle time" sub="From started to done, by week finished (hours)"
      legend={<Legend items={series.map((s) => ({ label: s.label, cls: s.cls, kind: 'line' }))} />}
      table={<table><thead><tr><th>Week of</th><th>Median</th><th>85th pct</th><th>Tasks</th></tr></thead><tbody>{data.map((d) => <tr key={d.weekStart}><td>{shortDay(d.weekStart)}</td><td>{duration(d.medianHours)}</td><td>{duration(d.p85Hours)}</td><td>{d.samples}</td></tr>)}</tbody></table>}>
      {values.length === 0 ? <p className="cal-board-note">Nothing finished in this range yet.</p> : (
        <div ref={ref} className="cal-viz">
          <svg width={width} height={PLOT_H + AXIS_H + 8} role="img" aria-label="Cycle time by week (median and 85th percentile)">
            <g transform="translate(0,8)">
              {tk.map((v) => (
                <g key={v}>
                  <line className="viz-grid" x1={AXIS_W} x2={width} y1={y(v)} y2={y(v)} />
                  <text className="viz-axis" x={AXIS_W - 6} y={y(v)} dy="0.32em" textAnchor="end">{v}</text>
                </g>
              ))}
              {data.map((d, i) => <text key={d.weekStart} className="viz-axis" x={x(i)} y={PLOT_H + 16} textAnchor="middle">{data.length > 8 && i % 2 ? '' : shortDay(d.weekStart)}</text>)}
              <line className="viz-baseline" x1={AXIS_W} x2={width} y1={PLOT_H} y2={PLOT_H} />
              {hover !== null && <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={PLOT_H} />}
              {series.map((s) => <path key={s.key} className={`viz-line ${s.cls}`} d={path(s.key)} />)}
              {series.map((s) => data.map((d, i) => d[s.key] == null ? null : (
                <circle key={`${s.key}${i}`} className={`viz-dot ${s.cls}`} cx={x(i)} cy={y(d[s.key]!)} r={hover === i || i === last ? 4.5 : 0} />
              )))}
              <rect className="viz-hit" x={AXIS_W} y={0} width={plotW + 12} height={PLOT_H} tabIndex={0}
                aria-label="Cycle time readout; use left and right arrows"
                onPointerMove={onMove} onPointerLeave={() => setHover(null)} onFocus={() => setHover(last)} onBlur={() => setHover(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last) - 1))
                  if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? 0) + 1))
                }} />
            </g>
          </svg>
          {hover !== null && (
            <Tooltip x={x(hover)} y={20} width={width}>
              <span>Week of {shortDay(data[hover]!.weekStart)} · {data[hover]!.samples} tasks</span>
              {series.map((s) => <div key={s.key} className="cal-viz-tip-row"><i className={`viz-key-line ${s.cls}`} /><strong>{duration(data[hover]![s.key])}</strong> {s.label}</div>)}
            </Tooltip>
          )}
        </div>
      )}
    </Card>
  )
}

function Flow({ r }: { r: TaskReport }) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const data = r.flow
  // Stack order (bottom → top) and colors follow the category, never its size.
  const layers = [
    { key: 'done' as const, label: 'Done', cls: 'viz-s3' },
    { key: 'doing' as const, label: 'In progress', cls: 'viz-s2' },
    { key: 'todo' as const, label: 'To do', cls: 'viz-s1' },
  ]
  const totals = data.map((d) => d.todo + d.doing + d.done)
  const tk = ticks(Math.max(...totals, 1))
  const top = tk.at(-1)!
  const plotW = width - AXIS_W - 12
  const x = (i: number) => AXIS_W + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1))
  const y = (v: number) => PLOT_H - (v / top) * PLOT_H
  const area = (li: number) => {
    const below = (d: (typeof data)[number]) => layers.slice(0, li).reduce((n, l) => n + d[l.key], 0)
    const upper = data.map((d, i) => `${x(i)},${y(below(d) + d[layers[li]!.key])}`)
    const lower = data.map((d, i) => `${x(i)},${y(below(d))}`).reverse()
    return `M${upper.join(' L')} L${lower.join(' L')} Z`
  }
  const last = data.length - 1
  const labelEvery = Math.ceil(data.length / 6)
  return (
    <Card title="Cumulative flow" sub="Tasks by category at the end of each day (live tasks)"
      legend={<Legend items={[...layers].reverse().map((l) => ({ label: l.label, cls: l.cls, kind: 'rect' }))} />}
      table={<table><thead><tr><th>Day</th><th>To do</th><th>In progress</th><th>Done</th></tr></thead><tbody>{data.map((d) => <tr key={d.day}><td>{shortDay(d.day)}</td><td>{d.todo}</td><td>{d.doing}</td><td>{d.done}</td></tr>)}</tbody></table>}>
      <div ref={ref} className="cal-viz">
        <svg width={width} height={PLOT_H + AXIS_H + 8} role="img" aria-label={`Cumulative flow; today ${data[last]?.todo} to do, ${data[last]?.doing} in progress, ${data[last]?.done} done`}>
          <g transform="translate(0,8)">
            {tk.map((v) => (
              <g key={v}>
                <line className="viz-grid" x1={AXIS_W} x2={width} y1={y(v)} y2={y(v)} />
                <text className="viz-axis" x={AXIS_W - 6} y={y(v)} dy="0.32em" textAnchor="end">{v}</text>
              </g>
            ))}
            {layers.map((l, li) => <path key={l.key} className={`viz-area ${l.cls}`} d={area(li)} />)}
            {data.map((d, i) => ((i % labelEvery === 0 && last - i >= labelEvery / 2) || i === last ? <text key={d.day} className="viz-axis" x={x(i)} y={PLOT_H + 16} textAnchor={i === last ? 'end' : 'middle'}>{shortDay(d.day)}</text> : null))}
            {hover !== null && <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={PLOT_H} />}
            <rect className="viz-hit" x={AXIS_W} y={0} width={plotW + 12} height={PLOT_H} tabIndex={0}
              aria-label="Cumulative flow readout; use left and right arrows"
              onPointerMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect()
                setHover(Math.max(0, Math.min(last, Math.round(((e.clientX - box.left) / plotW) * last))))
              }}
              onPointerLeave={() => setHover(null)} onFocus={() => setHover(last)} onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last) - 1))
                if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? 0) + 1))
              }} />
          </g>
        </svg>
        {hover !== null && (
          <Tooltip x={x(hover)} y={20} width={width}>
            <span>{shortDay(data[hover]!.day)}</span>
            {[...layers].reverse().map((l) => <div key={l.key} className="cal-viz-tip-row"><i className={`viz-key-rect ${l.cls}`} /><strong>{data[hover]![l.key]}</strong> {l.label}</div>)}
          </Tooltip>
        )}
      </div>
    </Card>
  )
}

function People({ r }: { r: TaskReport }) {
  return (
    <section className="cal-chart-card" aria-label="Open work by person">
      <header><div><h3>Open work by person</h3><p>Not done, right now</p></div></header>
      {r.people.length === 0 ? <p className="cal-board-note">No open tasks.</p> : (
        <div className="cal-chart-table">
          <table>
            <thead><tr><th>Person</th><th>To do</th><th>In progress</th><th>Blocked</th><th>Overdue</th></tr></thead>
            <tbody>
              {r.people.map((p) => (
                <tr key={p.memberId ?? 'none'}><td>{p.name}</td><td>{p.todo}</td><td>{p.doing}</td><td>{p.blocked || '—'}</td><td>{p.overdue || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Legend({ items }: { items: { label: string; cls: string; kind: 'line' | 'rect' }[] }) {
  return (
    <ul className="cal-legend" aria-label="Legend">
      {items.map((it) => <li key={it.label}><i className={`${it.kind === 'line' ? 'viz-key-line' : 'viz-key-rect'} ${it.cls}`} />{it.label}</li>)}
    </ul>
  )
}
