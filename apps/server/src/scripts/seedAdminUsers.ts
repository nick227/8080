import { db } from '@project/db'
import { seedAdminUsers } from '../seeds/adminUsers'

seedAdminUsers().then(result => {
  console.log(`Admin mock users: ${result.created} created, ${result.preserved} preserved (${result.fixtureCount} fixtures).`)
  console.log('Search for [Mock] in /admin. Mock accounts have no login password and no platform staff privileges.')
}).catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => db.$disconnect())
