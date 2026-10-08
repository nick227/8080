import './CsvExample.css'

export function CsvExample({ example, note }: { example: string; note: string }) {
  return (
    <div className="csv-example">
      <p>Example CSV · first row contains column headers</p>
      <pre><code>{example}</code></pre>
      <p>{note}</p>
    </div>
  )
}
