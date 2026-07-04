import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";
function loadEnvFile(f){const p=resolve(process.cwd(),f);if(!existsSync(p))return;for(const line of readFileSync(p,"utf8").split(/\r?\n/)){const t=line.trim();if(!t||t.startsWith("#"))continue;const eq=t.indexOf("=");if(eq<0)continue;const k=t.slice(0,eq).trim();let v=t.slice(eq+1).trim();if(!k||process.env[k])continue;if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);process.env[k]=v;}}
function loadKey(){let fp=process.env.GOOGLE_ADMIN_SA_KEY_FILE?.trim();let raw;if(process.env.GOOGLE_ADMIN_SA_KEY_BASE64)raw=Buffer.from(process.env.GOOGLE_ADMIN_SA_KEY_BASE64,"base64").toString("utf8");else{if(!fp||!existsSync(fp))fp=resolve(process.cwd(),"secrets/service-account.json");raw=readFileSync(fp,"utf8");}const k=JSON.parse(raw);return{clientEmail:k.client_email,privateKey:k.private_key.replace(/\n/g,"\n")};}
loadEnvFile(".env.local");loadEnvFile(".env");
const key=loadKey();
const auth=new google.auth.JWT({email:key.clientEmail,key:key.privateKey,scopes:["https://www.googleapis.com/auth/admin.directory.group","https://www.googleapis.com/auth/admin.directory.group.member"],subject:process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL});
const dir=google.admin({version:"directory_v1",auth});
const groupEmail=process.argv[2];
const members=[];let pt;
do{const res=await dir.members.list({groupKey:groupEmail,maxResults:200,pageToken:pt});for(const m of res.data.members||[])members.push(m);pt=res.data.nextPageToken;}while(pt);
console.log(`Group ${groupEmail} — ${members.length} thành viên:\n`);
for(const m of members.sort((a,b)=>(a.email||"").localeCompare(b.email||"")))console.log(`  ${m.email}  [${m.role}/${m.type}/${m.status}]`);
const needle=(process.argv[3]||"").toLowerCase();
if(needle){const hit=members.filter(m=>(m.email||"").toLowerCase().includes(needle));console.log(`\nKhớp "${needle}": ${hit.length?hit.map(h=>h.email).join(", "):"KHÔNG CÓ"}`);}
