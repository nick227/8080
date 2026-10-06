// Idempotent: inventory imageUrl playback URLs → RecordImage rows.
import { RecordImageService } from '../services/RecordImageService'

async function main() {
  const result = await new RecordImageService().migrateLegacyInventory()
  console.log(`record-images migrate: created=${result.created} skipped=${result.skipped}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
