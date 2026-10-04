// A participant's name plus whatever tag the data carries (e.g. BOT). Every place
// that names a person uses this, so people and bots render alike and disclosure
// is never a special case (doc/08 I7).
export function PersonName({ name, tag, className }: { name: string; tag?: string | null; className?: string }) {
  return (
    <span className={className}>
      {name}
      {tag ? <span className="person-tag">{tag}</span> : null}
    </span>
  )
}

/** Plain-text form for labels and captions: "chatbot (BOT)". */
export function nameWithTag(name: string, tag?: string | null) {
  return tag ? `${name} (${tag})` : name
}
