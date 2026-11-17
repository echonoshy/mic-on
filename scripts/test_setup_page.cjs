// Offline DOM/HTTP simulation: executes the actual embedded setup script.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(){this.value='';this.children=[];this.textContent='';this.hidden=false;this.disabled=false}
 append(...nodes){this.children.push(...nodes);if(!this.value&&nodes[0]?.value!==undefined)this.value=nodes[0].value}
 replaceChildren(){this.children=[];this.value=''}
 get selectedOptions(){return this.children.filter(x=>x.value===this.value)}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};
let state={nonce:'setup-token',state:'idle'}, scan={scanning:false,error:'',networks:[{ssid:'<img src=x onerror=alert(1)>',rssi:-45,secured:true,supported:true},{ssid:'Open & free',rssi:-70,secured:false,supported:true},{ssid:'Office enterprise',rssi:-20,secured:true,supported:false}]};
let requests=[],timers=[];
const context={document:{getElementById:get,createElement:()=>new Element()},URLSearchParams,AbortSignal:{timeout:()=>null},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{},confirm:()=>true,fetch:async(path,options)=>{
 requests.push({path,...options});
 let data=path==='/api/setup'?state:path==='/api/scan'?scan:path==='/networks'?[]:{};
 if(path==='/configure'){state={nonce:'setup-token',state:'connecting'};data=state}
 return {ok:true,json:async()=>structuredClone(data),text:async()=>path==='/finish'?'Restarting.':''};
}};
const script=fs.readFileSync('firmware/main/setup.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
vm.createContext(context);vm.runInContext(script,context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 await flush();await flush();
 assert(requests.some(x=>x.path==='/api/scan'&&x.method==='POST'),'initial automatic scan');
 assert.equal(get('network').children.length,3,'two supported APs plus manual option');
 assert(get('network').children[0].textContent.startsWith('<img '),'SSID handled as text, never HTML');
 const chosen=scan.networks[0], open=scan.networks[1];
 get('password').value='test-passphrase';
 async function refresh(networks) {
  scan.networks=networks;
  await get('refresh').onclick();await flush();
 }
 const neighbor={ssid:'Neighbor',rssi:-40,secured:true,supported:true};
 await refresh([neighbor,{...chosen,rssi:-80}]);
 assert.equal(get('network').value,'1','refresh keeps the same SSID after signal and sort order change');
 assert.equal(get('password').value,'test-passphrase');
 await refresh([open,{...chosen,rssi:-80,secured:false}]);
 assert.equal(get('network').value,'manual','a different security mode is a different selection');
 assert.equal(get('password').value,'','credentials for a disappeared network must be cleared');
 get('ssid').value='Hidden network';get('password').value='manual-passphrase';
 await refresh([chosen,open]);
 assert.equal(get('network').value,'manual','refresh keeps a hidden network selection');
 assert.equal(get('ssid').value,'Hidden network');assert.equal(get('password').value,'manual-passphrase');
 get('network').value='0';get('network').onchange();
 assert.equal(get('password').value,'','a new selection must not inherit the previous password');
 get('network').value='1';get('network').onchange();assert(get('password-row').hidden);
 await get('connect').onsubmit({preventDefault(){}});
 const sent=requests.find(x=>x.path==='/configure');assert.equal(sent.headers['X-Setup-Nonce'],'setup-token');assert.equal(sent.body.get('ssid'),'Open & free');assert.equal(sent.body.get('password'),'');
 state={nonce:'setup-token',state:'failed',error:'Authentication failed.'};await vm.runInContext('poll()',context);assert.equal(get('notice').textContent,'Authentication failed.');assert(!get('join').disabled);assert(get('success').hidden);
 get('network').value='manual';get('network').onchange();assert(!get('manual-row').hidden);assert(get('ssid').required);
 state={nonce:'setup-token',state:'connected',ssid:'My network',ip:'192.168.1.8',connected:true};await vm.runInContext('poll()',context);assert(!get('success').hidden);assert(get('result').textContent.includes('My network'));
 assert(!requests.some(x=>x.path==='/finish'),'success waits for explicit Finish');
 state.connected=false;await vm.runInContext('poll()',context);assert(get('success').hidden,'lost connection is not presented as success');
 console.log('PASS: scan refresh retains network identity and manual credentials, selection changes clear passwords, open/manual setup, failure retry, IP confirmation and explicit finish');
})().catch(e=>{console.error(e);process.exitCode=1});
