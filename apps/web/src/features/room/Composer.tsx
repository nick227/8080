export function Composer({ onOpen }: { onOpen: () => void }) {
  return (
    <footer className="room-bar">
      <div className="room-bar-in">
        <div className="room-tools">
          <button type="button" onClick={onOpen}>Aa</button>
          <button type="button" onClick={onOpen}>Upload</button>
          <button type="button" className="room-record" onClick={onOpen}>● Record</button>
        </div>
      </div>
    </footer>
  )
}
