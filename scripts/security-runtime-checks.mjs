/** Isolated production-config checks. Dummy credentials are never sent to a provider. */
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base={...process.env,NODE_ENV:'production',PAYMENT_PROVIDER:'razorpay',RAZORPAY_KEY_ID:'test-only',RAZORPAY_KEY_SECRET:'test-only',RAZORPAY_WEBHOOK_SECRET:'test-only',JWT_ACCESS_SECRET:'a'.repeat(48),JWT_REFRESH_SECRET:'b'.repeat(48),DELIVERY_OTP_SECRET:'c'.repeat(48),BCRYPT_ROUNDS:'10',LOG_LEVEL:'silent'};
function run(code,extra={}){return spawnSync(process.execPath,['-e',code],{cwd:new URL('../apps/api/',import.meta.url),env:{...base,...extra},encoding:'utf8'});}
const config="require('./dist/config/env.js')";
for(const [label,extra,message] of [
 ['mock payments',{PAYMENT_PROVIDER:'mock'},'real payment provider'],
 ['weak bcrypt cost',{BCRYPT_ROUNDS:'4'},'BCRYPT_ROUNDS'],
 ['missing delivery OTP secret',{DELIVERY_OTP_SECRET:''},'DELIVERY_OTP_SECRET'],
]){const result=run(config,extra);assert.notEqual(result.status,0);assert.ok(result.stderr.includes(message));console.log('PASS: production rejects '+label);}
const cookies=run("const c=[];require('./dist/modules/auth/auth.cookies.js').setAuthCookies({cookie:(n,v,o)=>c.push(o)},{accessToken:'test',refreshToken:'test',expiresIn:900});if(c.length!==2||c.some(o=>!o.secure||!o.httpOnly||o.sameSite!=='lax'))process.exit(1)");assert.equal(cookies.status,0,cookies.stderr);console.log('PASS: production cookies are Secure, HttpOnly and SameSite=Lax');
