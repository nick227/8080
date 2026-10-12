import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
const output = await mkdtemp(join(tmpdir(), '8080-admin-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/admin.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await readFile(join(output, 'fixture.css'), 'utf8')
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []; page.on('pageerror', e=>errors.push(e.message))
  let authorized = true; let mutations = 0; let search = ''; let billingConfigured=false; let previewFailure=false
  const user = { id:'user-1', email:'alex@example.test', displayName:'Alex Rivera', isGuest:false, kind:'human', suspendedAt:null, createdAt:'2026-10-01T12:00:00Z', version:0, staffRole:null, premium:{tier:'free',source:null,expiresAt:null,liveAvailable:false,liveUnavailableReason:'Premium is required for Live.'},memberships:[{id:'member-1',role:'member',status:'active',workspace:{id:'workspace-1',name:'Fieldwork Studio'}}],activity:[],grants:[],grantCount:0,availableActions:['suspend','grant_premium'],billingConfigured:false }
  await page.route('https://admin.test/**', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType:'text/html',body:`<style>body{margin:0}${css}</style><div id="root"></div><script>${script}</script>` })
    if (!authorized) return route.fulfill({ status:403,json:{error:'Platform staff access required'} })
    if (url.pathname === '/api/admin/me') return route.fulfill({json:{data:{role:'platform_owner',csrfToken:'csrf-test'}}})
    if (url.pathname === '/api/admin/users') { search = url.searchParams.get('q') ?? ''; return route.fulfill({json:{data:search === 'nobody' ? [] : [user],nextCursor:null}}) }
    if (url.pathname === '/api/admin/subscriptions') return route.fulfill({json:{configured:billingConfigured,mode:billingConfigured?'test':null,fetchedAt:billingConfigured?new Date().toISOString():null,nextCursor:null,data:billingConfigured?[{id:'sub_demo',customerId:'cus_demo',user:{id:user.id,displayName:user.displayName,email:user.email},status:'active',invoiceStatus:'open',interval:'1 month',dateLabel:'Ends',date:'2027-01-01T12:00:00Z',dashboardUrl:'https://dashboard.stripe.com/test/subscriptions/sub_demo'}]:[]}})
    if (url.pathname.endsWith('/preview')) {
      assert.equal(route.request().headers()['x-admin-csrf'],'csrf-test')
      if(previewFailure) return route.fulfill({status:503,json:{error:'Preview unavailable'}})
      const body=route.request().postDataJSON()
      const before={account:'active',tier:user.premium.tier,expiresAt:user.premium.expiresAt}
      const end=body.expiresAt && (!before.expiresAt || body.expiresAt>before.expiresAt)?body.expiresAt:before.expiresAt
      return route.fulfill({json:{data:{before,after:{...before,tier:end?'premium':'free',expiresAt:end},affectedGrantCount:1,effectiveAt:new Date().toISOString(),billingImpact:'No charge, refund, or subscription change. Existing Stripe billing, if any, continues.',liveImpact:'Live stays disabled for everyone until usage limits are set.'}}})
    }
    if (url.pathname.endsWith('/actions')) {
      const body = route.request().postDataJSON()
      assert.equal(route.request().headers()['x-admin-csrf'],'csrf-test')
      assert.equal(body.confirmed,true); assert.equal(body.expectedVersion,user.version)
      mutations++
      if (body.action === 'grant_premium') { user.premium = {tier:'premium',source:'grant',expiresAt:body.expiresAt,liveAvailable:false,liveUnavailableReason:'Premium Live is paused until usage limits are set.'}; user.grants=[{id:'grant-1',startsAt:new Date().toISOString(),expiresAt:body.expiresAt,revokedAt:null,status:'active',reason:body.reason}];user.grantCount=1;user.availableActions.push('revoke_premium') }
      user.version++; user.activity.unshift({id:`event-${mutations}`,action:body.action,reason:body.reason,createdAt:new Date().toISOString(),actorId:'owner'})
      return route.fulfill({json:{data:user}})
    }
    return route.fulfill({json:{data:user}})
  })
  await page.goto('https://admin.test/admin')
  await page.getByRole('button',{name:/Alex Rivera/}).click()
  await expect(page.getByRole('heading',{name:'Alex Rivera'})).toBeVisible()
  await expect(page.getByText('Fieldwork Studio')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Billing',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Grant Premium',exact:true}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(mutations,0)
  await page.getByRole('button',{name:'Grant Premium',exact:true}).click()
  await page.getByLabel('Premium expires').fill(new Date(Date.now()+30*86400000).toISOString().slice(0,16))
  await expect(page.getByRole('region',{name:'Change preview'})).toBeVisible()
  await page.getByRole('textbox',{name:'Reason'}).fill('Approved early member access')
  await page.getByRole('button',{name:'Confirm grant'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Premium · complimentary')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Grant history'})).toBeVisible()
  assert.equal(mutations,1)
  await page.getByRole('button',{name:'Grant Premium',exact:true}).click()
  await page.getByLabel('Premium expires').fill(new Date(Date.now()+86400000).toISOString().slice(0,16))
  await expect(page.getByText('A later expiry already applies. This grant will not extend current access.')).toBeVisible()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  previewFailure=true
  await page.getByRole('button',{name:'Revoke grant: Approved early member access'}).click()
  await expect(page.getByRole('alert')).toContainText('Preview unavailable')
  await expect(page.getByRole('button',{name:'Confirm revocation'})).toBeDisabled()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  previewFailure=false
  await mkdir('../../artifacts/admin',{recursive:true})
  await page.screenshot({path:'../../artifacts/admin/users-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),'Mobile layout must not overflow')
  await page.screenshot({path:'../../artifacts/admin/users-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Close user details'}).click()
  await page.getByRole('searchbox').fill('nobody')
  await expect(page.getByText('No users match this search.')).toBeVisible()
  assert.equal(search,'nobody')
  user.availableActions=[]
  await page.goto('https://admin.test/admin?user=user-1')
  await expect(page.getByRole('heading',{name:'Alex Rivera'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Grant Premium',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Suspend account',exact:true})).toHaveCount(0)
  await page.getByRole('link',{name:'Billing',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Stripe is not connected'})).toBeVisible()
  billingConfigured=true
  await page.getByRole('button',{name:'Refresh',exact:true}).click()
  await expect(page.getByText('Stripe test mode — not real charges')).toBeVisible()
  await expect(page.getByRole('cell',{name:'open',exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:'Open Stripe'})).toHaveAttribute('href','https://dashboard.stripe.com/test/subscriptions/sub_demo')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),'Billing must scroll within its table on mobile')
  await page.setViewportSize({width:1440,height:1000})
  await page.screenshot({path:'../../artifacts/admin/billing-desktop.png',fullPage:true})
  await page.getByRole('link',{name:'Blueprints',exact:true}).click()
  await page.getByRole('tab',{name:/Demo submissions/}).click()
  await expect(page.getByText(/Demo submissions only/)).toBeVisible()
  await page.getByRole('button',{name:'Simulate approval',exact:true}).click()
  await expect(page.getByText('Demo approval recorded in this page only. Nothing was published or saved.')).toBeVisible()
  authorized=false
  await page.goto('https://admin.test/admin')
  await expect(page.getByRole('heading',{name:'Staff access required'})).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  assert.deepEqual(errors,[])
  console.log('Passed: access-aware actions, grant history, server previews, failure blocking, read-only billing states, Blueprint demo labeling, desktop/mobile layout.')
} finally { await browser.close(); await rm(output,{recursive:true,force:true}) }
