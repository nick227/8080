// Built-in Agent types, registered once on import (docs/agents/03, 06).
import { registerCatalogTypes } from './catalog'
import { registerTeamTypes } from './team'

registerTeamTypes()
registerCatalogTypes()
