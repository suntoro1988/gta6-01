// jobs.js — Sunset Bay job data: 18 chained missions + taxi fares. Data only.
export const MISSIONS=[
{id:1,name:'First Wheels',brief:'Borrow a car and learn the streets.',reward:100,stages:[{type:'go',x:60,z:40,text:'Reach the car park'},{type:'pickup',x:60,z:40,text:'Take the keys'},{type:'deliver',x:-80,z:90,text:'Drop the car at the garage'}]},
{id:2,name:'Package Run',brief:'Grab the package and deliver it on time.',reward:150,stages:[{type:'pickup',x:-120,z:-60,text:'Pick up the package'},{type:'deliver',x:140,z:120,text:'Deliver to the client'},{type:'go',x:0,z:0,text:'Return to the safehouse'}]},
{id:3,name:'Street Race',brief:'Beat the checkpoints across town.',reward:200,stages:[{type:'race',x:200,z:-100,text:'Checkpoint 1'},{type:'race',x:240,z:150,text:'Checkpoint 2'},{type:'race',x:-40,z:220,text:'Finish line'}]},
{id:4,name:'Midnight Courier',brief:'Two drops before sunrise. No questions.',reward:250,stages:[{type:'pickup',x:-200,z:40,text:'Collect the goods'},{type:'deliver',x:90,z:-160,text:'First drop'},{type:'deliver',x:260,z:60,text:'Second drop'}]},
{id:5,name:'Getaway Driver',brief:'Pick up the crew and lose the tail.',reward:300,stages:[{type:'pickup',x:120,z:200,text:'Pick up the crew'},{type:'escape',x:-240,z:-120,text:'Escape to the hideout'}]},
{id:6,name:'Pier Pickup',brief:'Something washed up at the pier.',reward:350,stages:[{type:'go',x:300,z:40,text:'Reach the pier'},{type:'pickup',x:300,z:40,text:'Grab the crate'},{type:'deliver',x:-60,z:-200,text:'Deliver the crate'}]},
{id:7,name:'Beach Run',brief:'Flat out along the sand.',reward:400,stages:[{type:'race',x:-180,z:280,text:'Checkpoint 1'},{type:'race',x:60,z:320,text:'Checkpoint 2'},{type:'race',x:280,z:260,text:'Finish line'}]},
{id:8,name:'Bank Job',brief:'In and out of the bank. Fast.',reward:500,stages:[{type:'go',x:120,z:-80,text:'Reach the bank'},{type:'pickup',x:120,z:-80,text:'Grab the cash'},{type:'escape',x:-300,z:150,text:'Escape the area'}]},
{id:9,name:'Boat Escape',brief:'Reach the marina and vanish by sea.',reward:550,stages:[{type:'go',x:-280,z:200,text:'Reach the marina'},{type:'escape',x:-320,z:320,text:'Board the boat'}]},
{id:10,name:'Downtown Dash',brief:'Three checkpoints through downtown.',reward:600,stages:[{type:'race',x:40,z:-40,text:'Checkpoint 1'},{type:'race',x:-100,z:60,text:'Checkpoint 2'},{type:'race',x:160,z:-120,text:'Finish line'}]},
{id:11,name:'Night Shift',brief:'Two late drops across the bay.',reward:650,stages:[{type:'deliver',x:180,z:-200,text:'First drop'},{type:'deliver',x:-220,z:220,text:'Second drop'}]},
{id:12,name:'Harbor Deal',brief:'A quiet exchange at the harbor.',reward:700,stages:[{type:'pickup',x:-280,z:180,text:'Collect the briefcase'},{type:'deliver',x:100,z:100,text:'Hand it over'}]},
{id:13,name:'Rooftop Drop',brief:'Up high, then gone.',reward:800,stages:[{type:'go',x:0,z:-240,text:'Reach the tower'},{type:'deliver',x:220,z:-260,text:'Make the drop'}]},
{id:14,name:'High Roller',brief:'Win the race, then disappear.',reward:900,stages:[{type:'race',x:260,z:-180,text:'Checkpoint 1'},{type:'race',x:-60,z:-300,text:'Checkpoint 2'},{type:'escape',x:0,z:0,text:'Lose the heat'}]},
{id:15,name:'The Long Haul',brief:'Cross the whole map with the cargo.',reward:1000,stages:[{type:'pickup',x:-320,z:-40,text:'Load the cargo'},{type:'deliver',x:320,z:-120,text:'First stop'},{type:'deliver',x:140,z:280,text:'Final stop'}]},
{id:16,name:'Heat Wave',brief:'The whole city is looking for you.',reward:1100,stages:[{type:'escape',x:-160,z:-160,text:'Break the cordon'},{type:'escape',x:200,z:240,text:'Vanish at the docks'}]},
{id:17,name:"Kingpin's Favor",brief:'One last job for the top.',reward:1250,stages:[{type:'pickup',x:80,z:240,text:'Collect the package'},{type:'deliver',x:-140,z:-240,text:'Deliver uptown'},{type:'race',x:260,z:120,text:'Race back downtown'}]},
{id:18,name:'Sunset Heist',brief:'The big one. Hit the vault at sunset.',reward:1500,stages:[{type:'go',x:150,z:150,text:'Reach the vault'},{type:'pickup',x:150,z:150,text:'Crack the vault'},{type:'deliver',x:-260,z:260,text:'Move the loot'},{type:'escape',x:0,z:-320,text:'Escape by sunset'}]},
];
export const TAXI_FARES={min:40,mid:70,max:120};
export function taxiJob(pickup,dropoff){
  const dx=(dropoff.x||0)-(pickup.x||0),dz=(dropoff.z||0)-(pickup.z||0);
  const distance=Math.round(Math.hypot(dx,dz));
  const fare=Math.max(TAXI_FARES.min,Math.min(TAXI_FARES.max,Math.round(distance*0.35)));
  return {pickup:{x:pickup.x||0,z:pickup.z||0},dropoff:{x:dropoff.x||0,z:dropoff.z||0},fare,distance};
}
export const missionHelpers={
  byId(id){return MISSIONS.find(m=>m.id===id)||null;},
  totalReward(){return MISSIONS.reduce((s,m)=>s+m.reward,0);},
  stageCount(){return MISSIONS.reduce((s,m)=>s+m.stages.length,0);},
  next(i){return MISSIONS[Math.min(i+1,MISSIONS.length-1)];},
};
