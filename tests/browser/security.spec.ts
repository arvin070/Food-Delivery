import { test,expect,type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../apps/api/src/core/prisma';
const email='browser-security-'+randomUUID()+'@test.lunch',password='BrowserTest123!';
let userId:string;
test.beforeAll(async({request})=>{
 const r=await request.post('/api/v1/auth/register',{data:{fullName:'Browser Test Parent',email,password,role:'PARENT'},headers:{Origin:'http://127.0.0.1:3107'}});expect(r.status()).toBe(201);userId=(await r.json()).data.user.id;
});
test.afterAll(async()=>{if(userId)await prisma.user.delete({where:{id:userId}});await prisma.$disconnect();});
async function login(page:Page,next='/profile'){
 await page.goto('/login?next='+encodeURIComponent(next));await page.getByLabel('Email or phone').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
test('browser login uses HttpOnly cookies and authorized pages render',async({page,context})=>{
 await login(page);await expect(page).toHaveURL(/\/profile$/);await expect(page.getByRole('heading',{name:/profile/i}).first()).toBeVisible();
 const cookies=await context.cookies();expect(cookies.find(c=>c.name==='lunch_access_token')?.httpOnly).toBe(true);
 expect(await page.evaluate(()=>document.cookie)).not.toContain('lunch_access_token');
 await page.goto('/intelligence');await expect(page.getByRole('heading',{name:'Lunch assistant'})).toBeVisible();
});
for(const next of ['//evil.example/steal','/\\evil.example/steal'])test('rejects external login redirect '+next,async({page})=>{
 await login(page,next);await expect(page).toHaveURL('http://127.0.0.1:3107/meals');
});
test('stored markup renders as text without executing in the browser',async({page})=>{
 await login(page);await expect(page).toHaveURL(/\/profile$/);
 const payload='<img src=x onerror="window.__lunchXss=1">';
 const response=await page.request.patch('/api/v1/profile/me',{data:{fullName:payload},headers:{Origin:'http://127.0.0.1:3107'}});expect(response.status()).toBe(200);
 await page.reload();await expect(page.getByText(payload,{exact:true}).first()).toBeVisible();expect(await page.locator('img[src="x"]').count()).toBe(0);
 expect(await page.evaluate(()=>Reflect.get(window,'__lunchXss'))).toBeUndefined();
 await page.request.patch('/api/v1/profile/me',{data:{fullName:'Browser Test Parent'},headers:{Origin:'http://127.0.0.1:3107'}});
});
test('customer is denied admin page/API and cookie writes without an origin',async({page})=>{
 await login(page);await expect(page).toHaveURL(/\/profile$/);
 await page.goto('/admin/analytics');await expect(page).toHaveURL(/\/meals$/);
 expect((await page.request.get('/api/v1/admin/analytics')).status()).toBe(403);
 expect((await page.request.patch('/api/v1/profile/me',{data:{fullName:'Forged change'}})).status()).toBe(403);
 expect((await page.request.patch('/api/v1/profile/me',{data:{fullName:'Forged change'},headers:{Origin:'http://evil.example'}})).status()).toBe(403);
 const r=await page.request.get('/api/v1/profile/me');expect(r.headers()['cache-control']).toContain('no-store');
});
test('web security headers and logout revocation are effective',async({page})=>{
 await login(page);await expect(page).toHaveURL(/\/profile$/);
 const response=await page.goto('/profile');expect(response!.headers()['x-frame-options']).toBe('DENY');expect(response!.headers()['x-content-type-options']).toBe('nosniff');expect(response!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/logout'));
 await page.getByRole('button',{name:'Sign out',exact:true}).click();expect((await responsePromise).status()).toBe(204);
 await page.goto('/profile');await expect(page).toHaveURL(/\/login/);
});
test('logout failure stays visible instead of pretending the session ended',async({page})=>{
 await login(page);await expect(page).toHaveURL(/\/profile$/);
 await page.route('**/api/v1/auth/logout',route=>route.abort());
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Your session is still active'})).toBeVisible();
 await expect(page).toHaveURL(/\/profile$/);
 expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);
});
test('mounted credential and webhook limits reject requests despite spoofed client IP headers',async({request})=>{
 let limited=false;
 for(let i=0;i<21;i++){
  const r=await request.post('http://127.0.0.1:4107/api/v1/auth/login',{data:{identifier:'missing@test.invalid',password:'invalid'},headers:{'X-Forwarded-For':'192.0.2.'+i}});
  if(r.status()===429){limited=true;break;}
  expect([401,422]).toContain(r.status());
 }
 expect(limited).toBe(true);
 let webhookLimited=false;
 for(let i=0;i<121;i++){
  const r=await request.post('http://127.0.0.1:4107/api/v1/payments/webhooks/mock',{data:{},headers:{'X-Forwarded-For':'198.51.100.'+(i%250)}});
  if(r.status()===429){webhookLimited=true;break;}
  expect(r.status()).toBe(400);
 }
 expect(webhookLimited).toBe(true);
});
