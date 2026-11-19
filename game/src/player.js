// player.js — on-foot movement + combat.
const WALK=6,SPRINT=12,RADIUS=0.6,BOUND=380;
const WEAPONS=[
 {name:'Fists',dmg:25,range:2.4,rate:0.45},
 {name:'Pistol',dmg:34,range:60,rate:0.28},
 {name:'SMG',dmg:18,range:45,rate:0.09},
 {name:'Shotgun',dmg:22,range:26,rate:0.85,pellets:6}];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function hurt(t,d){if(t.takeDamage)t.takeDamage(d);else if(typeof t.hp==='number')t.hp-=d;}
function findTarget(p,tg,rg,cn){
  if(!Array.isArray(tg))return null;
  let best=null,bd=rg;const cc=Math.cos(cn),sx=Math.sin(p.yaw),cz=Math.cos(p.yaw);
  for(const t of tg){
    if(!t||!t.pos||t.hp<=0)continue;
    const dx=t.pos.x-p.pos.x,dz=t.pos.z-p.pos.z,d=Math.hypot(dx,dz);
    if(d>bd)continue;
    if(d>0&&(dx*sx+dz*cz)/d<cc)continue;
    best=t;bd=d;
  }
  return best;
}
export function createPlayer(spawn){
  const s=spawn||{};
  const p={pos:{x:s.x||0,y:0,z:s.z||0},vel:{x:0,z:0},yaw:s.yaw||0,health:100,armor:0,
    weapon:0,ammo:[Infinity,72,180,24],weapons:WEAPONS,_cd:0,_punchCd:0,_hurtT:99};
  p.update=(dt,input,city)=>{
    const inp=input||{};
    if(typeof inp.yaw==='number')p.yaw=inp.yaw;
    let mx=inp.x||0,mz=inp.z||0;
    const len=Math.hypot(mx,mz);if(len>1){mx/=len;mz/=len;}
    const sp=inp.sprint?SPRINT:WALK,sin=Math.sin(p.yaw),cos=Math.cos(p.yaw);
    p.vel.x=(mz*sin+mx*cos)*sp;p.vel.z=(mz*cos-mx*sin)*sp;
    let nx=p.pos.x+p.vel.x*dt,nz=p.pos.z+p.vel.z*dt;
    const f=city&&city.collideCircle;
    if(f){const c=f(nx,nz,RADIUS);if(c){nx=c.x;nz=c.z;}}
    p.pos.x=clamp(nx,-BOUND,BOUND);p.pos.z=clamp(nz,-BOUND,BOUND);
    p._cd-=dt;p._punchCd-=dt;p._hurtT+=dt;
    if(p._hurtT>8&&p.health>0&&p.health<100)p.health=Math.min(100,p.health+2.5*dt);
  };
  p.punch=tg=>{
    if(p._punchCd>0)return null;
    p._punchCd=0.45;
    const w=WEAPONS[0],hit=findTarget(p,tg,w.range,1.1);
    if(hit)hurt(hit,w.dmg);
    return {hit:!!hit,damage:hit?w.dmg:0,target:hit||null};
  };
  p.shoot=tg=>{
    const w=WEAPONS[p.weapon];
    if(p._cd>0)return null;
    if(p.ammo[p.weapon]<=0)return {hit:false,empty:true,damage:0};
    p._cd=w.rate;
    if(p.ammo[p.weapon]!==Infinity)p.ammo[p.weapon]--;
    const hit=findTarget(p,tg,w.range,p.weapon===3?0.28:0.12);
    let dmg=0;
    if(hit){const d=Math.hypot(hit.pos.x-p.pos.x,hit.pos.z-p.pos.z);
      dmg=Math.round(w.dmg*(w.pellets||1)*(d<w.range*0.5?1:0.5));hurt(hit,dmg);}
    return {hit:!!hit,damage:dmg,target:hit||null,ammo:p.ammo[p.weapon]};
  };
  p.takeDamage=n=>{
    if(n<=0||p.health<=0)return false;
    let rest=n;
    if(p.armor>0){const ab=Math.min(p.armor,n*0.6);p.armor-=ab;rest-=ab;}
    p.health=Math.max(0,p.health-rest);p._hurtT=0;
    return p.health<=0;
  };
  p.selectWeapon=i=>{p.weapon=clamp(i|0,0,3);};
  return p;
}
