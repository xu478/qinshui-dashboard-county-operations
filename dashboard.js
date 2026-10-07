
  'use strict';
  const $=id=>document.getElementById(id), money=n=>Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}), shortMoney=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:0});
  const BASELINE_FACTOR=.6,scaledBaseline=value=>Number.isFinite(value)?value*BASELINE_FACTOR:null;
  const initialConfig={stores:10,logistics:70,delivery:44,ontime:99.7,ontimeChange:.6,sortingItems:13000,palletItems:2050,coldCapacity:10,coldRemaining:53.2,storageMetricsSource:'user-configuration',warehouse:120,warehouseUnit:'吨',cold:50,coldUnit:'吨',rankSpeed:6,storeRankSpeed:9,replaySpeed:3,q1ActualStores:null,q1ActualLogistics:null,q2ActualStores:null,q2ActualLogistics:null,q3ActualStores:null,q3ActualLogistics:null,q4ActualStores:null,q4ActualLogistics:null,octStores:5,octLogistics:8,novStandard:1,novFranchise:5,novLogistics:10,decFranchise:20,decLogistics:10,holidayWeight:2,brandCount:3,brandDaily:8600,cooperativeCount:6,sundayWeight:1.5,double11Weight:2.2,peakStart:'17:30',peakEnd:'19:10'};
  let config={...initialConfig};try{const saved=JSON.parse(localStorage.getItem('qinshui-county-operations-config-v1')||'null');if(saved&&typeof saved==='object'){config={...initialConfig,...saved};if(saved.storeRankSpeed===undefined)config.storeRankSpeed=(Number.isFinite(Number(saved.rankSpeed))&&Number(saved.rankSpeed)>0?Number(saved.rankSpeed):6)+3;}}catch{}
  const storageMetric=(value,integer=false)=>Number.isFinite(value)&&value>=0&&(!integer||Number.isSafeInteger(value))?String(value):'—';
  function storageCapacity(){
    const zoneCount=Number.isSafeInteger(config.coldCapacity)&&config.coldCapacity>=0?config.coldCapacity:null;
    const currentStorageTonnes=Number.isFinite(config.coldRemaining)&&config.coldRemaining>=0?config.coldRemaining:null;
    return {totalTonnes:null,remainingTonnes:null,zoneCount,currentStorageTonnes,unit:'吨',source:'user-configuration'};
  }
  function fitBoard(){document.documentElement.style.setProperty('--board-scale',Math.min(window.innerWidth/3268,window.innerHeight/1290));}
  fitBoard();window.addEventListener('resize',fitBoard);
  const state={mode:'demo',source:'prepared',day:'2026-10-03',replayed:0,playing:true,product:'price',unit:'kg',storeOffset:0,productOffset:0,flowCursor:0,flowTick:0,flowEpoch:Date.now()};
  let mapPointState={points:MAP_DATA.points.map(p=>({...p})),originId:MAP_DATA.settings.dispatchOriginId||MAP_DATA.points.find(p=>p.isDispatchOrigin)?.id||''};
  try{const saved=JSON.parse(localStorage.getItem('qinshui-county-operations-map-v1')||'null');if(saved&&Array.isArray(saved.points)&&saved.points.every(p=>p.id&&p.name&&p.type&&Number.isFinite(p.longitude)&&Number.isFinite(p.latitude)&&Math.abs(p.longitude)<=180&&Math.abs(p.latitude)<=90))mapPointState=saved;}catch{}
  const townMap=new QinshuiTownMap($('townMap'),pointData());
  const monthWeights=[1,1.2,1.3,1.1,1,1.4,1.6];
  let decisionAdvice=null,decisionBatchRevision=0,weatherFeed=null,consumerMetrics=null;
  let consumerReplayRun=0,consumerReplayBatch=null,consumerReplayStep=-1;
  const lastStoreValues=new Map();let storeFlow=null,storeSourceKey=null,salesForecast=null;
  const charts={}, colors={text:'#ffffff',muted:'#92a0b7',grid:'rgba(46,172,226,0.15)',cyan:'#2eace2',gold:'#ffe551',mint:'#64d6ad'};
  const chart=(id)=>charts[id]||(charts[id]=echarts.init($(id),null,{renderer:'svg'}));
  const localISO=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const nowText=()=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
  const weekdayText=(date=localISO())=>['周日','周一','周二','周三','周四','周五','周六'][new Date(date+'T12:00:00Z').getUTCDay()];
  const activeSiteRatio=()=>Number(config.logistics)>0&&Number.isFinite(Number(config.delivery))?(Number(config.delivery)/Number(config.logistics)*100).toFixed(2)+'%':'—';
  let tickerSpans=null,clockBusinessDate=null;
  function renderTicker(v=view()){
    const iso=localISO(),month=Number(iso.slice(5,7)),day=Number(iso.slice(8,10));
    const holiday=month===10&&day<=7;
    const history=Object.values(DASHBOARD_DATA.days).map(d=>d.retail),low=Math.min(...history),high=Math.max(...history);
    const weight=monthWeights[month-6];
    const businessLabel=state.mode==='real'&&!dataset().isToday?'门店 '+state.day+' 销售':'门店今日销售';
    const items=[
      `${businessLabel} <b>¥${shortMoney(v.retail)}</b> · 历史日销售区间 <b>¥${shortMoney(low)}–${shortMoney(high)}</b>`,
      holiday?`国庆假期权重 <b>${Number(config.holidayWeight).toFixed(2)}</b>（10.01–10.07）· 今日黄金周第 <b>${day}</b> 天`:`${month}月销售权重 <b>${weight===undefined?'待配置':Number(weight).toFixed(2)}</b>`,
      `后勤事业部在服 <b>${config.logistics} 家</b> 企事业单位 · 活跃网点占比 <b>${activeSiteRatio()}</b>`,
      `品牌代理 <b>${config.brandCount} 个</b> · 日均出货约 <b>¥${shortMoney(config.brandDaily)}</b>`,
      `农产品上行 · <b>${config.cooperativeCount} 个</b> 合作社 · 库区 <b>${storageMetric(storageCapacity().zoneCount,true)} 个</b> · 当前存储 <b>${storageMetric(storageCapacity().currentStorageTonnes)} 吨</b>`,
      `周日销售权重 <b>${Number(config.sundayWeight).toFixed(1)}</b> · 晚高峰预计 <b>${config.peakStart}–${config.peakEnd}</b>`,
      `10月预估新增：便民店 <b>+${config.octStores} 家</b> · 后勤网点 <b>+${config.octLogistics} 个</b>`,
      `<span class="warn">备货预警</span> 双十一权重 <b>${Number(config.double11Weight).toFixed(2)}</b> · ${iso.slice(5,10)<='10-25'?'建议10月25日前完成备货':'复核双十一备货与配送安排'}`
    ];
    if(!tickerSpans){
      $('tickerFlow').replaceChildren();tickerSpans=[];
      for(let copy=0;copy<2;copy++){
        const group=document.createElement('div');group.className='ticker-group';if(copy)group.setAttribute('aria-hidden','true');
        for(let i=0;i<items.length;i++){const span=document.createElement('span');span.className='ticker-item';group.append(span);tickerSpans.push(span);}
        $('tickerFlow').append(group);
      }
    }
    // Preserve the animated groups; changing sales never restarts the marquee.
    items.forEach((html,i)=>{for(const span of [tickerSpans[i],tickerSpans[i+items.length]])if(span.innerHTML!==html)span.innerHTML=html;});
  }
  function updateClock(){
    const date=localISO();
    if(clockBusinessDate&&clockBusinessDate!==date){state.replayed=0;state.flowCursor=0;state.flowTick=0;state.flowEpoch=Date.now();renderStats();consumerMetrics?.refresh();if(clockBusinessDate.slice(0,7)!==date.slice(0,7))renderPlans();}
    clockBusinessDate=date;
    $('clock').textContent=nowText();$('dataUpdate').textContent=date+' '+nowText();
    $('deliveryFoot').textContent=`活跃网点占比 ${activeSiteRatio()}`;
    renderTicker();
  }
  function toast(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3200);}
  let todayOrders=null;try{const saved=JSON.parse(localStorage.getItem('qinshui-today-orders-v1')||'null');if(saved?.date===localISO()&&Array.isArray(saved.events)&&saved.events.every(e=>e.date===saved.date&&e.kind==='retail'&&Number.isFinite(e.amount)&&DASHBOARD_DATA.stores.some(s=>s.code===e.code)))todayOrders=saved;}catch{}
  let preparedBatch=null;
  function activeBatch(){
    const date=localISO();
    if(todayOrders&&todayOrders.date!==date)todayOrders=null;
    if(todayOrders&&(state.mode==='demo'||todayOrders.mode!=='replay'))return todayOrders;
    if(state.mode==='demo'&&state.source==='prepared'){
      if(!preparedBatch||preparedBatch.date!==date)preparedBatch={date,mode:'replay',consumerReplayFingerprint:TODAY_REPLAY_DATA.metadata?.consumerReplayFingerprint,events:TODAY_REPLAY_DATA.events.map(e=>({...e,date})),details:TODAY_REPLAY_DATA.details.map(e=>({...e,date}))};
      return preparedBatch;
    }
    return null;
  }
  function sumMoney(events){return events.reduce((sum,e)=>sum+(Number.isInteger(e.amountCents)?e.amountCents:Math.round(e.amount*100)),0)/100;}
  function dataset(){
    const batch=activeBatch();
    if(batch){const events=batch.events,retail=sumMoney(events),stores=Object.fromEntries(DASHBOARD_DATA.stores.map(s=>[s.code,0]));events.forEach(e=>stores[e.code]+=e.amount);return {total:retail,retail,wholesale:0,stores,events,details:batch.details||[],orderCount:events.length,retailCount:events.length,isToday:true,simulated:batch.mode==='replay',date:batch.date};}
    return {...DASHBOARD_DATA.days[state.day],isToday:false};
  }
  function view(){
    const day=dataset();
    if(state.mode==='real')return {total:day.total,retail:day.retail,wholesale:day.wholesale,stores:day.stores,events:day.events.slice(-3).reverse(),count:day.orderCount,retailCount:day.retailCount,average:day.retailCount?day.retail/day.retailCount:null};
    const played=day.events.slice(0,state.replayed),retailOrders=played.filter(e=>e.kind==='retail'),retail=sumMoney(retailOrders),wholesale=sumMoney(played.filter(e=>e.kind==='wholesale')),stores=Object.fromEntries(DASHBOARD_DATA.stores.map(s=>[s.code,scaledBaseline(s.baseline)]));
    retailOrders.forEach(e=>stores[e.code]=(stores[e.code]||0)+e.amount);
    // Average order value uses only orders already accumulated, never the baseline.
    return {total:scaledBaseline(DASHBOARD_DATA.baseline)+retail+wholesale,retail:scaledBaseline(DASHBOARD_DATA.retailBaseline)+retail,wholesale:scaledBaseline(DASHBOARD_DATA.wholesaleBaseline)+wholesale,stores,events:played.slice(-3).reverse(),count:played.length,retailCount:retailOrders.length,average:retailOrders.length?retail/retailOrders.length:null};
  }
  function displayedFlow(v){
    if(state.mode==='real')return v.events;
    const source=dataset().events.slice(0,state.replayed),n=source.length;
    if(!n)return [];
    const end=(n-1+state.flowCursor)%n;
    return Array.from({length:Math.min(3,n)},(_,i)=>{
      const e=source[(end-i+n)%n],when=new Date(state.flowEpoch+(state.flowTick-i)*Number(config.replaySpeed)*1000);
      return {...e,displayTime:new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(when)};
    });
  }
  function renderConsumerMetrics(){
    if(!consumerMetrics)return;
    const batch=activeBatch(),source=window.CONSUMER_REPLAY_DATA;
    const matched=state.mode==='demo'&&batch?.mode==='replay'&&source?.sourceKind==='historical-order-replay'
      &&source.fingerprintAlgorithm==='sha256-json-key-amountCents-v1'&&batch.consumerReplayFingerprint===source.sourceFingerprint
      &&Number.isSafeInteger(source.eventCount)&&source.eventCount===batch.events.length&&Array.isArray(source.steps)&&source.steps.length===source.eventCount;
    if(!matched){consumerMetrics.clearReplay();consumerReplayBatch=null;consumerReplayStep=-1;return;}
    const step=Math.min(batch.events.length,Math.max(0,state.replayed));
    if(consumerReplayBatch!==batch||step<consumerReplayStep){consumerReplayRun++;consumerReplayStep=-1;}
    if(step===consumerReplayStep)return;
    const entry=step===0?{step:0,counts:source.initialCounts}:source.steps[step-1];
    if(!entry||entry.step!==step){consumerMetrics.clearReplay();consumerReplayBatch=null;consumerReplayStep=-1;return;}
    const applied=consumerMetrics.updateReplay({sourceKind:'historical-order-replay',updatedAt:source.updatedAt,window:source.window,counts:entry.counts,
      replay:{sourceVersion:source.sourceFingerprint,runId:'consumer-replay-'+consumerReplayRun,step,total:source.eventCount}});
    if(applied){consumerReplayBatch=batch;consumerReplayStep=step;}
  }
  function renderStats(){
    const v=view(),demo=state.mode==='demo',day=dataset();
    const salesChanged=$('salesValue').textContent!==money(v.total);
    $('salesValue').textContent=money(v.total);
    if(salesChanged){$('salesValue').classList.remove('order-value-update');void $('salesValue').offsetWidth;$('salesValue').classList.add('order-value-update');}
    $('salesLabel').textContent=demo||day.isToday?'今日销售额':'历史日净销售额';
    const comparisonBase=scaledBaseline(!demo&&day.isToday?DASHBOARD_DATA.retailBaseline:DASHBOARD_DATA.baseline);
    const change=comparisonBase>0?(v.total-comparisonBase)/comparisonBase*100:null;
    $('salesFoot').textContent=change===null?'— vs 昨日':`${change<0?'▼':'▲'} ${Math.abs(change).toFixed(1)}% vs 昨日`;
    $('salesFoot').classList.toggle('red',change<0);
    $('retailTotal').textContent='¥'+money(v.retail);$('deliveryValue').textContent=config.delivery;$('deliveryFoot').textContent=`活跃网点占比 ${activeSiteRatio()}`;
    $('ontimeValue').textContent=Number(config.ontime).toFixed(1);$('ontimeFoot').textContent=`${config.ontimeChange>=0?'+':''}${Number(config.ontimeChange).toFixed(1)}pt 较上周`;
    $('siteValue').textContent=Number(config.stores)+Number(config.logistics);$('siteFoot').textContent=`门店 ${config.stores} + 后勤 ${config.logistics}`;$('averageOrder').textContent=v.average===null?'—':Number(v.average).toFixed(2);
    $('modeStatus').textContent=day.isToday?(day.simulated?'日均基数 + 10月2日、3日订单映射今日回放':'今日门店订单 · '+(demo?'基数 + 回放':'实收净额')):(demo?'日均基数 + 所选历史订单回放':'历史订单净销售额 · 不加基数');
    $('dataDayLabel').textContent=day.isToday?'历史预览日期':demo?'回放源日期':'业务日期';$('dataDay').disabled=day.isToday;
    $('dateInfo').textContent=day.isToday?`订单日期 ${day.date}${day.simulated?' · 演示（保留原始日期）':''}`:(demo?`展示日期 ${localISO()} · 演示`:'已导入历史数据，非今日实时');
    $('flowList').innerHTML=displayedFlow(v).map(e=>`<div class="flow-row"><span class="mono small">${e.displayTime||e.time||'—'}</span><span class="place" title="${e.name}">${e.name}</span><span class="flow-type">${e.type}</span><span class="flow-amount ${e.amount<0?'red':''}">${e.amount<0?'−':'¥'}${money(Math.abs(e.amount))}</span></div>`).join('');
    if(!v.events.length)$('flowList').innerHTML='<div class="small" style="padding:18px 0">暂无订单</div>';
    renderStores(v);renderTicker(v);renderConsumerMetrics();renderDecisions(v);
  }
  function renderStores(v){
    const day=dataset(),sourceKey=[state.mode,day.isToday?day.date:state.day,day.simulated?'replay':day.isToday?'actual':'historical',state.source].join(':');
    const sameSource=storeSourceKey===sourceKey;if(!sameSource){lastStoreValues.clear();storeSourceKey=sourceKey;}
    const all=DASHBOARD_DATA.stores.filter(s=>Number.isFinite(v.stores[s.code])).map(s=>({...s,value:v.stores[s.code]})).sort((a,b)=>b.value-a.value||a.code.localeCompare(b.code));
    const pinned=all.find(s=>s.code==='2001'),others=all.filter(s=>s.code!=='2001');
    const changed=all.filter(s=>lastStoreValues.has(s.code)?Math.abs(lastStoreValues.get(s.code)-s.value)>.0001:sameSource&&s.value!==0);
    if(changed.length){
      const code=changed.find(s=>s.code===v.events[0]?.code)?.code||changed[0].code,index=others.findIndex(s=>s.code===code);
      const start=state.storeOffset%Math.max(1,others.length-2);
      if(index>=0&&(index<start||index>=start+3))state.storeOffset=Math.min(Math.max(0,index-1),Math.max(0,others.length-3));
    }
    const positiveCodes=changed.filter(s=>s.value>(lastStoreValues.get(s.code)??0)+.0001).map(s=>s.code);for(const s of all)lastStoreValues.set(s.code,s.value);
    const rows=pinned?[...rankWindow(others,state.storeOffset,3),pinned]:rankWindow(all,state.storeOffset,4);state.storeRows=rows;
    const name='门店销售额',axisMax=30000;
    chart('storeChart').setOption({
      animationDuration:800,animationDurationUpdate:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:1000,animationEasingUpdate:'cubicOut',grid:{left:206,right:138,top:20,bottom:55},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>{const p=params[0];return p?`${p.axisValue}<br>${name}：¥${money(p.data.rawValue)}`:'';}},legend:{show:false},
      xAxis:{type:'log',logBase:10,name:'元（对数刻度）',nameLocation:'end',nameGap:64,min:100,max:axisMax,
        nameTextStyle:{color:colors.muted,fontSize:18},axisTick:{show:false},
        axisLabel:{color:colors.muted,fontSize:18,formatter:n=>n>=10000?Number((n/10000).toFixed(1))+'万':n>=1000?n:n===100?'100':''},minorTick:{show:false},minorSplitLine:{show:false},splitLine:{show:true,lineStyle:{color:colors.grid}}},
      yAxis:{type:'category',inverse:true,data:rows.map(s=>s.name),axisLabel:{color:colors.text,fontSize:18},axisTick:{show:false},axisLine:{show:false}},
      series:[{id:'store-sales',name,type:'bar',data:rows.map(s=>({id:s.code,name:s.code,value:Math.min(axisMax,Math.max(101,s.value)),rawValue:s.value,label:{position:s.value>=22000?'insideRight':'right',color:s.value>=22000?'#eaffff':colors.cyan}})),barWidth:13,itemStyle:{color:{type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:'#205d68'},{offset:1,color:'#20d7ec'}]},borderRadius:[0,5,5,0]},
        label:{show:true,fontSize:22,formatter:p=>'¥'+shortMoney(p.data.rawValue)}}]
    },false);
    storeFlow?.update({rows,positiveCodes,changedCodes:changed.map(s=>s.code),sourceKey});
  }
  function setMode(mode){state.mode=mode;state.storeOffset=0;$('demoMode').classList.toggle('active',mode==='demo');$('realMode').classList.toggle('active',mode==='real');$('demoMode').setAttribute('aria-pressed',String(mode==='demo'));$('realMode').setAttribute('aria-pressed',String(mode==='real'));renderStats();}
  function renderMonitor(){
    $('mapSortingItems').textContent=storageMetric(config.sortingItems,true);
    $('mapPalletItems').textContent=storageMetric(config.palletItems,true);
    $('mapColdCapacity').textContent=storageMetric(config.coldCapacity,true);
    $('mapColdRemaining').textContent=storageMetric(config.coldRemaining);
  }
  function renderPlans(){
    const quarter=Number($('planQuarter').value),known=quarter===4;
    const currentMonth=Number(localISO().slice(5,7)),monthClass=month=>'month-plan-column forecast'+(currentMonth===month?' current-month':'');
    const stores=[Number(config.octStores),Number(config.novStandard)+Number(config.novFranchise),Number(config.decFranchise)];
    const posts=[Number(config.octLogistics),Number(config.novLogistics),Number(config.decLogistics)];
    $('planTitle').textContent=`Q${quarter} 开店与网点拓展计划`;
    const card=(title,value,note)=>`<div class="month-plan-card"><div><span>${title}</span><strong>${value}</strong></div><p>${note}</p></div>`;
    $('quarterDetail').innerHTML=known?`<div class="${monthClass(10)}" data-plan-month="10">${card('新增便民店','+'+stores[0]+' 家','10月预估完成 · 社区布点')}${card('后勤服务网点','+'+posts[0]+' 个','10月预估完成 · 后勤服务')}</div><div class="${monthClass(11)}" data-plan-month="11">${card('3000㎡ 标准店',config.novStandard+' 家','月末开业 · 同步新增加盟店 '+config.novFranchise+' 家')}${card('后勤服务网点扩容','+'+posts[1]+' 个','11月计划 · 配送线路扩容')}</div><div class="${monthClass(12)}" data-plan-month="12">${card('新增加盟店','+'+stores[2]+' 家','12月计划 · 年末消费高峰前布局')}${card('后勤服务网点','+'+posts[2]+' 个','累计预计 '+(Number(config.logistics)+posts[1]+posts[2])+' 个')}</div>`:`<div class="quarter-missing">该季度逐月新增和计划尚未记录</div>`;
    const barData=(values,color)=>values.map(value=>({value,itemStyle:{color:color==='#2eace2'?'rgba(148,215,245,.25)':'rgba(255,242,183,.25)',borderColor:color==='#2eace2'?'#94d7f5':'#fff2b7',borderWidth:1}}));
    chart('planChart').setOption({animationDuration:350,grid:{left:54,right:24,top:28,bottom:34},legend:{top:0,textStyle:{color:colors.muted,fontSize:18},itemWidth:18,itemHeight:8},tooltip:{trigger:'axis',formatter:p=>`${p[0].axisValue}<br>${p.map(x=>x.seriesName+'：'+(x.value==null?'未记录':x.value+' 家/个')).join('<br>')}`},xAxis:{type:'category',data:known?['10月 · 预估','11月 · 计划','12月 · 计划']:['逐月数据待补'],axisLabel:{color:colors.text,fontSize:20,interval:0},axisTick:{show:false},axisLine:{lineStyle:{color:colors.grid}}},yAxis:{type:'value',min:0,minInterval:1,splitNumber:2,axisLabel:{color:colors.muted,fontSize:17},splitLine:{lineStyle:{color:colors.grid}}},series:[{name:'新增门店',type:'bar',itemStyle:{color:colors.cyan},barWidth:32,data:known?barData(stores,'#2eace2'):[null],label:{show:true,position:'top',fontSize:21,color:'#bce6fa'}},{name:'新增后勤网点',type:'bar',itemStyle:{color:colors.gold},barWidth:32,data:known?barData(posts,'#ffe551'):[null],label:{show:true,position:'top',fontSize:21,color:'#fff2b7'}}]},true);
    renderWeights();renderDecisions();
  }
  function renderWeights(){
    try{salesForecast=SalesGrowthScenario.build(window.MONTHLY_SALES_DATA,{horizonMonths:3});}catch{salesForecast=null;}
    chart('weightChart').setOption(SalesTrend.buildOption(window.MONTHLY_SALES_DATA,colors,salesForecast),true);
    $('salesTrendScopeTag').textContent=salesForecast?.status==='ok'?'未来3个月预估':'预测数据不足';
    $('weightChart').setAttribute('aria-label','6月至9月园区真实销售与已有预期；'+(salesForecast?.status==='ok'?salesForecast.months.map(m=>m.month).join('、')+'销售预估':'未来销售预测暂缺'));
  }
  const products=[{name:'生鲜果蔬',price:103,indexRange:[98,116],amount:[6800,9800],kg:[160,230]},{name:'肉禽蛋奶',price:101,indexRange:[92,110],amount:[5200,7600],kg:[95,150]},{name:'粮油调味',price:99,indexRange:[88,104],amount:[3600,5400],kg:[55,88],袋:[60,95]},{name:'酒水饮料',price:97,indexRange:[84,102],amount:[2800,4600],瓶:[110,175]},{name:'日用百货',price:95,indexRange:[78,96],amount:[1600,2900],瓶:[45,75],袋:[35,65]}];
  function renderProducts(){
    const isPrice=state.product==='price',isAmount=state.product==='amount',unit=isPrice?'指数':isAmount?'元':state.unit;
    const all=products.filter(p=>state.product!=='quantity'||p[state.unit]).slice().sort((a,b)=>(isPrice?b.price-a.price:isAmount?b.amount[1]-a.amount[1]:b[state.unit][1]-a[state.unit][1]));
    const items=rankWindow(all,state.productOffset,3);state.productRows=items;$('quantityUnit').hidden=state.product!=='quantity';document.querySelectorAll('[data-product]').forEach(b=>b.classList.toggle('active',b.dataset.product===state.product));
    const ranges=items.map(p=>isPrice?p.indexRange:isAmount?p.amount:p[state.unit]);
    const series=[{name:isPrice?'自身历史价格指数':'预估下限',type:'bar',data:items.map((p,i)=>isPrice?p.price:ranges[i][0]),barWidth:8,itemStyle:{color:colors.gold},label:{show:true,position:'right',color:colors.gold,fontSize:19,formatter:p=>isPrice?p.value:shortMoney(p.value)}},{name:'区间起点',type:'bar',stack:'range',data:ranges.map(x=>x[0]),barWidth:14,itemStyle:{color:'transparent'},silent:true},{name:'预估区间',type:'bar',stack:'range',data:ranges.map(x=>x[1]-x[0]),barWidth:14,itemStyle:{color:'#c2cede44',borderColor:'#c2cede',borderWidth:1.2,borderType:'dashed'},label:{show:true,position:'right',color:'#c4d0df',fontSize:17,formatter:p=>ranges[p.dataIndex].map(shortMoney).join('–')}}];
    if(isPrice)series[0].markLine={symbol:'none',silent:true,label:{show:false},lineStyle:{type:'dashed',color:'#dc7777'},data:[{xAxis:100}]};
    chart('productChart').setOption({animationDurationUpdate:600,grid:{left:140,right:125,top:16,bottom:26},tooltip:{trigger:'axis',formatter:p=>{const i=p[0].dataIndex,d=items[i];return `${d.name}<br>${isPrice?'价格指数：'+d.price+'（自身历史售价=100）<br>':''}未来7天${isPrice?'销量（指数化）':''}：${ranges[i].map(shortMoney).join('–')} ${unit}`;}},xAxis:[{type:'value',name:unit,max:isPrice?200:Math.max(...ranges.map(x=>x[1]))*1.22,nameTextStyle:{color:colors.muted,fontSize:16},axisLabel:{color:colors.muted,fontSize:17,formatter:n=>n>=10000?Number((n/10000).toFixed(1))+'万':n},splitLine:{lineStyle:{color:colors.grid}}}],yAxis:{type:'category',inverse:true,data:items.map(p=>p.name),axisLabel:{color:colors.text,fontSize:19},axisLine:{show:false},axisTick:{show:false}},series},true);
    $('productLegendBase').textContent=isPrice?'自身历史价格指数':'预估下限';$('productRangeLegend').textContent=isPrice?'销量预估区间（指数化）':`未来7天预估区间 / ${unit}`;$('productCenterLegend').hidden=!isPrice;
  }
  function renderRadar(){
    chart('radarChart').setOption(ConsumerVisuals.decorateRadarOption({animation:false,legend:{orient:'vertical',right:2,top:'center',textStyle:{color:colors.muted,fontSize:17},itemWidth:17,itemHeight:10},radar:{center:['40%','47%'],radius:'58%',indicator:['消费频次','购物篮大小','生鲜偏好','价格敏感度','复购意愿','晚间消费'].map(name=>({name,max:100})),axisName:{color:colors.text,fontSize:17},splitLine:{lineStyle:{color:colors.grid}},splitArea:{show:false},axisLine:{lineStyle:{color:colors.grid}}},series:[{type:'radar',symbolSize:5,data:[{name:'门店客群',value:[76,61,89,64,72,81],lineStyle:{color:colors.gold,width:3},itemStyle:{color:colors.gold},areaStyle:{color:colors.gold,opacity:.1}},{name:'后勤单位客群',value:[61,80,55,76,65,41],lineStyle:{color:colors.cyan,type:'dashed',width:3},itemStyle:{color:colors.cyan},areaStyle:{color:colors.cyan,opacity:.06}}]}]}),true);
  }
  const basicFields=[['stores','在营门店数','家',0,999,1],['logistics','后勤事业部数','个',0,999,1],['delivery','后勤配送网点','家',0,999,1],['ontime','配送准时率','%',0,100,.1],['ontimeChange','相较上周变化','个百分点',-100,100,.1],['sortingItems','分拣拆零','个',0,999999,1],['palletItems','地堆区','个',0,999999,1],['coldCapacity','库区数','个',0,999999,1],['coldRemaining','当前存储量','吨',0,999999,.1],['warehouse','旧常温库存（待核验）','吨',0,999999,.1],['cold','旧冷链库存（待核验）','吨',0,999999,.1]];
  const planFields=[['octStores','10 月预估新增便民店','家'],['octLogistics','10 月预估新增后勤网点','个'],['novStandard','11 月标准店','家'],['novFranchise','11 月加盟店','家'],['novLogistics','11 月后勤网点','个'],['decFranchise','12 月加盟店','家'],['decLogistics','12 月后勤网点','个']];
  const tickerFields=[['holidayWeight','国庆假期权重','倍',0,20,.1],['brandCount','品牌代理数','个'],['brandDaily','品牌代理日均出货','元',0,9999999,.01],['cooperativeCount','合作社数','个'],['sundayWeight','周日销售权重','倍',0,20,.1],['double11Weight','双十一权重','倍',0,20,.1]];
  const actualPlanFields=Array.from({length:3},(_,i)=>i+1).flatMap(q=>[['q'+q+'ActualStores','Q'+q+'实际新增门店','家'],['q'+q+'ActualLogistics','Q'+q+'实际新增后勤网点','个']]);
  function syncStorageValidity(){}
  function fillConfig(values=config){const field=([key,label,unit,min=0,max=999,step=1])=>`<div class="field"><label for="cfg-${key}">${label}（${unit}）</label><input id="cfg-${key}" type="number" value="${values[key]}" required min="${min}" max="${max}" step="${step}"></div>`;$('basicFields').innerHTML=basicFields.map(field).join('')+`<div class="drawer-note storage-config-note">分拣拆零、地堆区和库区数按“个”展示；当前存储量按“吨”展示。旧库存配置仍待核验，不作为本轮展示数据。</div><div class="field"><label for="cfg-warehouseUnit">旧常温库存单位</label><select id="cfg-warehouseUnit"><option>吨</option><option>立方米</option><option>件</option></select></div><div class="field"><label for="cfg-coldUnit">旧冷链库存单位</label><select id="cfg-coldUnit"><option>吨</option><option>立方米</option><option>件</option></select></div>`;$('planFields').innerHTML=planFields.map(field).join('');$('tickerFields').innerHTML=tickerFields.map(field).join('')+`<div class="field"><label for="cfg-peakStart">预计晚高峰开始</label><input id="cfg-peakStart" type="time" required></div><div class="field"><label for="cfg-peakEnd">预计晚高峰结束</label><input id="cfg-peakEnd" type="time" required></div>`;$('cfg-peakStart').value=values.peakStart;$('cfg-peakEnd').value=values.peakEnd;$('actualPlanFields').innerHTML=actualPlanFields.map(([key,label,unit])=>`<div class="field"><label for="cfg-${key}">${label}（${unit}）</label><input id="cfg-${key}" type="number" min="0" max="999" step="1" value="${values[key]??''}" placeholder="未记录"></div>`).join('');$('cfg-warehouseUnit').value=values.warehouseUnit;$('cfg-coldUnit').value=values.coldUnit;$('cfgRankSpeed').value=values.rankSpeed;$('cfgStoreRankSpeed').value=values.storeRankSpeed;$('cfgReplaySpeed').value=values.replaySpeed;}
  function openConfig(){fillConfig();pane('basic');$('configBackdrop').classList.add('open');$('closeConfig').focus();}function closeConfig(){$('configBackdrop').classList.remove('open');$('openConfig').focus();}
  function saveConfig(){syncStorageValidity();const inputs=[...document.querySelectorAll('[id^="cfg-"]'),$('cfgRankSpeed'),$('cfgStoreRankSpeed'),$('cfgReplaySpeed')];for(const input of inputs)if(!input.checkValidity()){input.reportValidity();return;}for(const [key] of [...basicFields,...planFields,...tickerFields])config[key]=Number($('cfg-'+key).value);for(const [key] of actualPlanFields)config[key]=$('cfg-'+key).value===''?null:Number($('cfg-'+key).value);config.peakStart=$('cfg-peakStart').value;config.peakEnd=$('cfg-peakEnd').value;config.warehouseUnit=$('cfg-warehouseUnit').value;config.coldUnit=$('cfg-coldUnit').value;config.rankSpeed=Number($('cfgRankSpeed').value);config.storeRankSpeed=Number($('cfgStoreRankSpeed').value);config.replaySpeed=Number($('cfgReplaySpeed').value);config.storageMetricsSource='user-configuration';try{localStorage.setItem('qinshui-county-operations-config-v1',JSON.stringify(config));}catch{toast('当前浏览器不能保存配置，已应用到本次预览');}renderStats();renderMonitor();renderPlans();startTimers();closeConfig();toast('配置已保存到当前浏览器；其他访问者不会受影响');}
  function pane(name){document.querySelectorAll('[data-pane]').forEach(b=>b.classList.toggle('active',b.dataset.pane===name));document.querySelectorAll('[data-pane-body]').forEach(b=>b.classList.toggle('active',b.dataset.paneBody===name));$('saveConfig').hidden=name!=='basic';$('resetConfig').hidden=name!=='basic';if(name==='map')fillPointList();}
  let replayTimer,rankTimer,storeRankTimer;
  function startTimers(){
    clearInterval(replayTimer);clearInterval(rankTimer);clearInterval(storeRankTimer);
    replayTimer=setInterval(()=>{if(state.mode==='demo'&&state.playing){const n=dataset().events.length;if(state.replayed<n)state.replayed++;else if(n)state.flowCursor++;state.flowTick++;renderStats();}},config.replaySpeed*1000);
    storeRankTimer=setInterval(()=>{state.storeOffset++;renderStores(view());},config.storeRankSpeed*1000);
    rankTimer=setInterval(()=>{state.productOffset++;renderProducts();},config.rankSpeed*1000);
  }
  function rankWindow(items,offset,size){const start=offset%Math.max(1,items.length-size+1);return items.slice(start,start+size);}
  const LIVE_WEATHER_URL='https://api.open-meteo.com/v1/forecast?latitude=35.69&longitude=112.19&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&timezone=Asia%2FShanghai&forecast_days=7';
  const weatherText=code=>code===0?'晴':code<=2?'晴间多云':code===3?'阴':code<=48?'雾':code<=57?'毛毛雨':code<=67?'雨':code<=77?'雪':code<=82?'阵雨':code<=86?'阵雪':code>=95?'雷雨':'多云';
  const weatherGlyph=code=>code===0?'100':code<=2?'101':code===3?'104':code<=48?'500':code<=57?'305':code<=65?'306':code<=67?'313':code<=77?'400':code<=82?'300':code<=86?'407':code>=95?'302':'101';
  const liveNumber=value=>Number.isFinite(Number(value))?Number(value):null;
  const windLevel=kmh=>{const n=Number(kmh);if(!Number.isFinite(n))return null;const index=[1,6,12,20,29,39,50,62,75,89,103,118].findIndex(limit=>n<limit);return index<0?12:index;};
  const windDirection=degrees=>{const n=Number(degrees);if(!Number.isFinite(n))return null;return ['北风','东北风','东风','东南风','南风','西南风','西风','西北风'][Math.round((((n%360)+360)%360)/45)%8];};
  let liveWeatherTimer=null,weatherAdviceTimer=null,weatherAdviceIndex=0;
  function weatherAdvice(snapshot){
    const days=snapshot?.days||[],rain=days.map(day=>day.precipitationProbabilityPercent).filter(Number.isFinite),lows=days.map(day=>day.low).filter(Number.isFinite),highs=days.map(day=>day.high).filter(Number.isFinite),winds=days.map(day=>Number(day.windScale)).filter(Number.isFinite);
    const maxRain=rain.length?Math.round(Math.max(...rain)):null,minLow=lows.length?Math.round(Math.min(...lows)):null,maxHigh=highs.length?Math.round(Math.max(...highs)):null,maxWind=winds.length?Math.round(Math.max(...winds)):null;
    const demand=[
      `气温回落 + 秋季客流，<strong class="demand-highlight">热饮、火锅食材需求上行</strong>，门店晚高峰预计延长40分钟`,
      maxRain===null?'结合到店客流滚动补货，晚高峰前优先补齐熟食与便捷餐饮':maxRain>=50?`未来7天最高降水概率${maxRain}%，<strong class="demand-highlight">雨具、热饮与即时配送需求可能上升</strong>`:`未来7天最高降水概率${maxRain}%，<strong class="demand-highlight">适合安排户外陈列与社区促销</strong>`,
      minLow===null?'早晚温差待确认，建议按门店小时销量分批补货':`最低气温约${minLow}℃，<strong class="demand-highlight">早餐热食与晚间火锅食材</strong>建议增加小批量高频补货`,
      maxHigh===null?'周末到店需求可能集中，建议提前完成畅销品补货':`最高气温约${maxHigh}℃，建议饮品与常温食品按午后客流动态调整陈列`
    ];
    const agriculture=[
      maxRain!==null&&maxRain<=10?`未来7天降水概率≤${Math.max(10,maxRain)}%，<strong class="agriculture-highlight">利于秋收与农产品上行</strong>，建议合作社错峰采收`:maxRain===null?'未来7天降水数据待确认，合作社根据田间实况安排采收':`未来7天最高降水概率${maxRain}%，<strong class="agriculture-highlight">关注采收窗口与田间排水</strong>，建议合作社错峰作业`,
      minLow===null?'夜间低温待确认，入仓前加强分级与损耗检查':`最低气温约${minLow}℃，建议叶菜、鲜果<strong class="agriculture-highlight">缩短露天等待并及时预冷</strong>`,
      maxWind===null?'风力信息待确认，运输前检查周转筐与篷布固定':`未来7天最大风力约${maxWind}级，采收运输前检查大棚、篷布与周转筐固定`,
      `按县域门店周转节奏安排采收，<strong class="agriculture-highlight">优先小批量、分级入仓、当日配送</strong>`
    ];
    return {demand,agriculture};
  }
  function startWeatherAdvice(snapshot){
    clearInterval(weatherAdviceTimer);weatherAdviceIndex=0;
    const lists=weatherAdvice(snapshot),demand=$('weatherDemand')||document.querySelector('.weather-impacts>div:first-child p'),agriculture=$('weatherAgriculture')||document.querySelector('.weather-impacts>div:last-child p');
    const paint=()=>{if(!demand||!agriculture)return;demand.innerHTML=lists.demand[weatherAdviceIndex%lists.demand.length];agriculture.innerHTML=lists.agriculture[weatherAdviceIndex%lists.agriculture.length];for(const element of [demand,agriculture]){element.classList.remove('weather-advice-shift');void element.offsetWidth;element.classList.add('weather-advice-shift');}document.querySelector('.weather-panel').dataset.adviceIndex=String(weatherAdviceIndex);weatherAdviceIndex++;};
    paint();weatherAdviceTimer=setInterval(paint,5000);
  }
  async function refreshRealtimeWeather(){
    clearTimeout(liveWeatherTimer);
    try{
      const response=await fetch(LIVE_WEATHER_URL,{method:'GET',credentials:'omit',cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const input=await response.json(),current=input.current||{},daily=input.daily||{},fetchedAt=new Date().toISOString();
      if(!Array.isArray(daily.time)||!daily.time.length)throw new Error('天气预报字段缺失');
      const snapshot={snapshotVersion:'live-open-meteo-v1',status:'ok',provider:'Open-Meteo',location:{name:'沁水县',longitude:112.19,latitude:35.69,coordinateSystem:'WGS84'},fetchedAt,currentFetchedAt:fetchedAt,dailyFetchedAt:fetchedAt,
        current:{observedAt:current.time?(current.time.length===16?current.time+':00+08:00':current.time+'+08:00'):fetchedAt,temperature:liveNumber(current.temperature_2m),conditionText:weatherText(Number(current.weather_code)),conditionCode:weatherGlyph(Number(current.weather_code)),humidityPercent:liveNumber(current.relative_humidity_2m),windScale:windLevel(current.wind_speed_10m),windDirectionText:windDirection(current.wind_direction_10m)},
        days:daily.time.slice(0,7).map((date,index)=>({date,high:liveNumber(daily.temperature_2m_max?.[index]),low:liveNumber(daily.temperature_2m_min?.[index]),conditionText:weatherText(Number(daily.weather_code?.[index])),precipitationProbabilityPercent:liveNumber(daily.precipitation_probability_max?.[index]),dayPrecipitationMm:liveNumber(daily.precipitation_sum?.[index]),windScale:windLevel(daily.wind_speed_10m_max?.[index])})),
        attributions:['https://open-meteo.com/'],errors:[]};
      if(weatherFeed.update(snapshot,'live-open-meteo'))startWeatherAdvice(snapshot);
      $('weatherFeedStatus').textContent='沁水县实时天气已更新；每10分钟自动刷新。';
    }catch(error){$('weatherFeedStatus').textContent='实时天气暂时读取失败，已保留最近一次有效天气。';}
    finally{liveWeatherTimer=setTimeout(refreshRealtimeWeather,600000);}
    return true;
  }
  function renderWeather(){
    if(weatherFeed)return;
    weatherFeed=new WeatherFeed(document.querySelector('.weather-panel'),{
      snapshot:window.WEATHER_DATA||null,statusElement:$('weatherFeedStatus'),autoStart:false,persistConfig:false,
      onStatus:()=>renderDecisions(),
      configElements:{endpoint:$('weatherFeedEndpoint'),enabled:$('weatherFeedEnabled'),interval:$('weatherFeedInterval'),save:$('saveWeatherFeed')},
      renderChart:(model,meta)=>{
        const values=[...model.highs,...model.lows].filter(Number.isFinite);
        const lower=values.length?Math.floor((Math.min(...values)-2)/5)*5:0;
        const upper=values.length?Math.ceil((Math.max(...values)+2)/5)*5:30;
        chart('weatherChart').setOption({animation:!meta.reducedMotion,animationDurationUpdate:450,grid:{left:46,right:22,top:8,bottom:24},
          tooltip:{trigger:'axis',confine:true,renderMode:'richText',formatter:params=>{
            const i=params[0]?.dataIndex,day=model.days[i];if(!day)return '';
            const lines=[day.date,...params.filter(p=>p.value!=null).map(p=>`${p.seriesName}：${Number(p.value).toFixed(1)}°C`)];
            if(day.conditionText)lines.push(day.conditionText);
            if(Number.isFinite(day.precipitationProbabilityPercent))lines.push(`白天降水概率：${day.precipitationProbabilityPercent}%`);
            if(Number.isFinite(day.dayPrecipitationMm))lines.push(`白天降水量：${day.dayPrecipitationMm} mm`);
            return lines.join('\n');
          }},
          xAxis:{type:'category',data:model.dates,axisLabel:{color:colors.muted,fontSize:17},axisLine:{lineStyle:{color:colors.grid}},axisTick:{show:false}},
          yAxis:{type:'value',min:lower,max:Math.max(lower+5,upper),splitNumber:2,axisLabel:{color:colors.muted,fontSize:14,hideOverlap:true,formatter:n=>Number(n)===lower||Number(n)===Math.max(lower+5,upper)?`${n}°`:''},splitLine:{lineStyle:{color:colors.grid,type:'dashed'}}},
          series:[{name:'最高气温',type:'line',data:model.highs,connectNulls:false,symbolSize:6,lineStyle:{color:colors.gold,width:2.5},itemStyle:{color:colors.gold}},
            {name:'最低气温',type:'line',data:model.lows,connectNulls:false,symbolSize:6,lineStyle:{color:colors.cyan,width:2.5,type:'dashed'},itemStyle:{color:colors.cyan}}]
        },true);
      }
    });
    weatherFeed.refresh=refreshRealtimeWeather;
    startWeatherAdvice(weatherFeed.getState().snapshot);
    refreshRealtimeWeather();
  }
  function decisionContext(){
    const monthly=window.MONTHLY_SALES_DATA,consumer=consumerMetrics?.getState(false),weatherState=weatherFeed?.getState(),weather=weatherState?.snapshot;
    return {
      salesTrend:monthly?{source:'user-provided-monthly-sales',currency:monthly.currency,
        actual:monthly.months.map(row=>({month:row.month,amount:row.actualSalesCny,periodStart:row.month+'-01',periodEnd:row.actualPeriodEnd,complete:!row.partial})),
        forecast:monthly.months.map(row=>({month:row.month,amount:row.estimatedSalesCny,source:'user-forecast'})),baseline:{coefficient:BASELINE_FACTOR,source:'user-setting'}}:null,
      // Unverified old stock stays in config; item counts and capacity never become inventory.
      reserves:{ambientTonnes:null,coldTonnes:null,source:'legacy-stock-configuration-unverified'},
      capacity:storageCapacity(),
      consumerMetrics:consumer?{status:consumer.status,sourceKind:consumer.sourceKind,window:consumer.snapshot?.window||null,counts:consumer.snapshot?.counts||null,replay:consumer.replay?{step:consumer.replay.step,total:consumer.replay.total}:null}:null,
      weather:weather?{status:weather.status==='stale'?'stale':weatherState.status,provider:weather.provider,observedAt:weather.current.observedAt,currentFetchedAt:weather.currentFetchedAt,dailyFetchedAt:weather.dailyFetchedAt,
        temperature:weather.current.temperature,days:weather.days.map(day=>({date:day.date,high:day.high,low:day.low,dayPrecipitationMm:day.dayPrecipitationMm,windScale:day.windScale}))}:null
    };
  }
  function renderDecisions(v=view()){
    if(!decisionAdvice)return;
    const day=dataset(),orders=state.mode==='demo'?day.events.slice(0,state.replayed):day.events;
    const retailOrders=orders.filter(order=>order.kind==='retail'),grouped=new Map();
    for(const order of retailOrders){
      const entry=grouped.get(order.code)||{name:DASHBOARD_DATA.stores.find(store=>store.code===order.code)?.name||order.name,amountCents:0,count:0};
      entry.amountCents+=Number.isInteger(order.amountCents)?order.amountCents:Math.round(order.amount*100);entry.count++;grouped.set(order.code,entry);
    }
    const historySummary=state.mode==='real'&&!day.isToday;
    const sourceKind=state.mode==='demo'?'replay':day.isToday?'actual-today':'historical';
    const topOrderStores=historySummary?DASHBOARD_DATA.stores.filter(store=>Number.isFinite(day.stores[store.code])).map(store=>({name:store.name,amount:day.stores[store.code],count:null})).sort((a,b)=>b.amount-a.amount).slice(0,3):[...grouped.values()].sort((a,b)=>b.amountCents-a.amountCents).slice(0,3).map(row=>({name:row.name,amount:row.amountCents/100,count:row.count}));
    decisionAdvice.update({
      businessDate:day.isToday?day.date:state.day,mode:state.mode,sourceKind,
      sourceVersion:[sourceKind,day.date||state.day,day.events.length,day.total,decisionBatchRevision].join(':'),
      updatedAt:localISO()+' '+nowText(),displayComposition:state.mode==='demo'?'baseline-plus-replay':'order-net',
      baselineSales:state.mode==='demo'?scaledBaseline(DASHBOARD_DATA.baseline):0,displayedSales:v.total,retail:v.retail,
      netOrderSales:historySummary?day.total:sumMoney(orders),retailOrderSales:historySummary?day.retail:sumMoney(retailOrders),orderCount:historySummary?day.orderCount:orders.length,retailOrderCount:historySummary?day.retailCount:retailOrders.length,
      averageOrder:v.average,refundCount:historySummary?null:orders.filter(order=>order.amount<0).length,
      recentOrder:!historySummary&&orders.length?{name:orders.at(-1).name,amount:orders.at(-1).amount}:null,
      topOrderStores,
      logistics:{active:Number(config.delivery),total:Number(config.logistics),ratio:Number(config.logistics)>0?Number(config.delivery)/Number(config.logistics)*100:null,source:'configuration',onTimePercent:Number(config.ontime),onTimeSource:'configuration'},
      plans:{octStores:Number(config.octStores),octLogistics:Number(config.octLogistics),source:'forecast-configuration'},
      ...decisionContext()
    });
  }
  function pointData(){return {...MAP_DATA,points:mapPointState.points,settings:{...MAP_DATA.settings,dispatchOriginId:mapPointState.originId,pointCoordinateSystemsConfirmed:Boolean(mapPointState.points.length),pointCoordinateSystem:mapPointState.points.length?'WGS84':MAP_DATA.settings.pointCoordinateSystem}};}
  function persistPoints(){
    try{localStorage.setItem('qinshui-county-operations-map-v1',JSON.stringify(mapPointState));}catch{$('pointFeedback').textContent='当前浏览器无法保存，已应用于本次预览。';}
    townMap.setData(pointData());fillPointList();
  }
  function fillPointList(){
    $('pointList').replaceChildren();
    for(const p of mapPointState.points){const row=document.createElement('div');row.className='point-row';const copy=document.createElement('div'),name=document.createElement('b'),coord=document.createElement('p');name.textContent=p.name;coord.textContent=`${p.type} · ${p.longitude}, ${p.latitude} · ${p.town||'待判定'}`;copy.append(name,coord);const edit=document.createElement('button');edit.textContent='编辑';edit.onclick=()=>{for(const [field,key] of [['pointId','id'],['pointName','name'],['pointType','type'],['pointLongitude','longitude'],['pointLatitude','latitude'],['pointTown','town']])$(field).value=p[key]??'';$('pointCrs').value='WGS84';};row.append(copy,edit);$('pointList').append(row);}
    const warehouses=mapPointState.points.filter(p=>p.type==='warehouse');$('dispatchOrigin').replaceChildren();$('dispatchOrigin').add(new Option('请选择真实园区仓库',''));for(const p of warehouses)$('dispatchOrigin').add(new Option(p.name,p.id));$('dispatchOrigin').value=mapPointState.originId||'';
    if(!mapPointState.points.length){const empty=document.createElement('p');empty.className='small';empty.textContent='表格坐标系尚未确认，未上屏；可在此录入明确为WGS84的点位。';$('pointList').append(empty);}
  }
  function initPoints(){
    $('applyGpsPoints').onclick=async()=>{
      const file=$('gpsPointFile').files?.[0];if(!file){$('gpsPointFeedback').textContent='请先选择现场采集页导出的JSON文件。';return;}
      if(file.size>1024*1024){$('gpsPointFeedback').textContent='文件过大，请使用采集页导出的点位JSON。';return;}
      try{
        const incoming=MapPointImport.parseGPS(JSON.parse(await file.text()),MAP_DATA.pendingPoints||[]);
        const points=MapPointImport.mergeGPS(mapPointState.points,incoming),origin=points.find(p=>p.isDispatchOrigin)||points.find(p=>p.id===mapPointState.originId);
        mapPointState={...mapPointState,points,originId:origin?.id||'',sourceCoordinateSystem:'WGS84',sourceCoordinateSystemConfirmedByUser:false};
        persistPoints();$('gpsPointFeedback').textContent=`已导入${incoming.length}条现场记录，当前显示${points.length}个点位。${origin?'园区线路已按真实起点连接。':'还未采集园区，已显示网点；补齐园区后自动连接线路。'}此处导入仅保存在当前浏览器。`;
      }catch(error){$('gpsPointFeedback').textContent=error instanceof SyntaxError?'JSON格式不正确，请重新导出文件。':error.message||'点位导入失败。';}
    };
    $('applySourcePoints').onclick=()=>{
      const crs=$('sourcePointCrs').value;
      if(crs!=='WGS84'){$('sourcePointFeedback').textContent=crs==='UNKNOWN'?'请先核实原表C列的坐标系；不能根据数值猜测或直接上屏。':`${crs}不能直接叠加WGS84边界，请先转换并核验坐标。`;return;}
      const source=MAP_DATA.pendingPoints||[],points=source.filter(p=>Number.isFinite(p.longitude)&&Number.isFinite(p.latitude)).map(p=>({...p,coordinateSystem:'WGS84',pointCoordinateSystem:'WGS84',coordinateSystemConfirmedByUser:true}));
      const origin=points.find(p=>p.isDispatchOrigin||p.sourceType==='园区');
      if(!origin){$('sourcePointFeedback').textContent='原表缺少有效园区坐标，无法启用园区线路；龙港镇100公里雷达独立显示。';return;}
      mapPointState={points,originId:origin.id,sourceCoordinateSystem:'WGS84',sourceCoordinateSystemConfirmedByUser:true};
      persistPoints();$('sourcePointFeedback').textContent=`已接入${points.length}条已确认WGS84点位；${source.length-points.length}条缺坐标保留待补。县界外点位按真实坐标显示并提示，不强行放入县域。`;
    };
    if(mapPointState.sourceCoordinateSystemConfirmedByUser){$('sourcePointCrs').value=mapPointState.sourceCoordinateSystem;$('sourcePointFeedback').textContent=`当前浏览器已接入${mapPointState.points.length}条已确认WGS84的原表点位。`;}
    for(const s of DASHBOARD_DATA.stores)$('pointPreset').add(new Option(s.name+' · '+s.code,s.code));for(const name of MAP_DATA.settings.expectedTownNames)$('pointTown').add(new Option(name,name));
    $('pointPreset').onchange=e=>{const store=DASHBOARD_DATA.stores.find(s=>s.code===e.target.value);if(!store)return;const found=mapPointState.points.find(p=>p.id==='store_'+store.code);$('pointId').value='store_'+store.code;$('pointName').value=store.name;$('pointType').value='store';$('pointLongitude').value=found?.longitude??'';$('pointLatitude').value=found?.latitude??'';$('pointTown').value=found?.town??'';};
    $('pointForm').onsubmit=e=>{e.preventDefault();if(!$('pointForm').reportValidity())return;if($('pointCrs').value!=='WGS84'){$('pointFeedback').textContent='GCJ-02 不能直接叠加到 WGS84 边界上，请先提供转换并核验后的坐标。';return;}const point={id:$('pointId').value.trim(),name:$('pointName').value.trim(),type:$('pointType').value,longitude:Number($('pointLongitude').value),latitude:Number($('pointLatitude').value),town:$('pointTown').value,coordinateSystem:'WGS84'};if(!point.id||!point.name){$('pointFeedback').textContent='请填写点位 ID 和名称。';return;}const i=mapPointState.points.findIndex(p=>p.id===point.id);if(i<0)mapPointState.points.push(point);else mapPointState.points[i]=point;if(!mapPointState.originId&&point.type==='warehouse')mapPointState.originId=point.id;persistPoints();$('pointFeedback').textContent='WGS84点位已保存并投影；县界外的点位按真实坐标显示并提示。';};
    $('dispatchOrigin').onchange=e=>{mapPointState.originId=e.target.value;persistPoints();};
    $('exportPoints').onclick=()=>{const blob=new Blob([JSON.stringify(mapPointState.points.map(p=>({...p,isDispatchOrigin:p.id===mapPointState.originId})),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='qinshui-map-points.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};fillPointList();
  }

  function init(){const storeChart=chart('storeChart');if(typeof storeChart.getModel==='function'&&typeof storeChart.getZr==='function'&&echarts.graphic)storeFlow=new StoreBarFlow(storeChart,{seriesId:'store-sales',durationMs:1200});consumerMetrics=new ConsumerMetrics($('consumerAnalysisPanel'),{snapshot:window.CONSUMER_METRICS_DATA||null,statusElement:$('consumerMetricsStatus'),expectedWindowDays:10,allowHistoricalWindow:true,precision:2,onStatus:()=>{renderDecisions();},configElements:{endpoint:$('consumerMetricsEndpoint'),enabled:$('consumerMetricsEnabled'),interval:$('consumerMetricsInterval'),save:$('saveConsumerMetrics')}});decisionAdvice=new DecisionAdvice($('decisionAdviceList'),{statusElement:$('aiAdviceStatus'),configElements:{endpoint:$('aiAdviceEndpoint'),enabled:$('aiAdviceEnabled'),interval:$('aiAdviceInterval'),save:$('saveAIAdvice')}});Object.keys(DASHBOARD_DATA.days).sort().forEach(day=>{$('dataDay').add(new Option(day,day));});$('dataDay').value=state.day;$('dataDay').onchange=e=>{state.day=e.target.value;state.source='history';state.storeOffset=0;state.replayed=0;state.flowCursor=0;state.flowTick=0;state.flowEpoch=Date.now();state.playing=true;renderStats();};$('demoMode').onclick=()=>setMode('demo');$('realMode').onclick=()=>setMode('real');$('openConfig').onclick=openConfig;$('openMapConfig').onclick=()=>{openConfig();pane('map');};$('planQuarter').onchange=renderPlans;$('closeConfig').onclick=closeConfig;$('saveConfig').onclick=saveConfig;$('resetConfig').onclick=()=>{fillConfig({...initialConfig});toast('已填入初始值，点击保存并预览后应用');};$('configBackdrop').onclick=e=>{if(e.target===$('configBackdrop'))closeConfig();};document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>pane(b.dataset.pane));$('openSources').onclick=()=>{$('sourcesModal').classList.add('open');$('closeSources').focus();};$('closeSources').onclick=()=>{$('sourcesModal').classList.remove('open');$('openSources').focus();};$('sourcesModal').onclick=e=>{if(e.target===$('sourcesModal'))$('closeSources').click();};document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('configBackdrop').classList.contains('open'))closeConfig();$('sourcesModal').classList.remove('open');}if(e.key==='Tab'){const modal=$('sourcesModal').classList.contains('open')?$('sourcesModal'):$('configBackdrop').classList.contains('open')?$('configBackdrop'):null;if(modal){const focusable=[...modal.querySelectorAll('button,input,select')].filter(el=>!el.hidden&&el.offsetParent!==null&&!el.disabled),first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}});$('fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('当前预览窗口不支持全屏，可在浏览器新窗口打开');}};document.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>{state.product=b.dataset.product;state.productOffset=0;renderProducts();});$('quantityUnit').onchange=e=>{state.unit=e.target.value;state.productOffset=0;renderProducts();};renderWeather();$('sourceRows').innerHTML=[['试营业销售基数','10 天 · 零售 + 批发 ¥417,280.88','已核对',false],['类别销售报表','期间自选 · 正式表头待业务确认','样表已收到',true],['零售订单主表','9,711 张 · 9 家门店 · 10 天','已核对',false],['今日演示订单与明细','10月2日、3日 · 2,049张订单 / 5,864条明细 · ¥55,774.59','逐单对账一致',false],['批发订单主表','283 张 · 批发与退单按净额计算','已核对',false],['批发订单明细','284 行样本 · 51 张单据','部分样本',true],['商品与分类表','SKU → 最小级分类 → 二级分类','待补齐',true],['月度实际与销售预估','6–9月完整实绩 · 10月截至5日 · 当月实际/预期对比 · 未来3个月预估','配置预估',true]].map(([name,note,status,pending])=>`<div class="source-row"><div><b>${name}</b><p>${note}</p></div><span class="source-status ${pending?'pending':''}">${status}</span></div>`).join('');initPoints();TodayOrderImport.init(DASHBOARD_DATA.stores,localISO,batch=>{todayOrders=batch;decisionBatchRevision++;state.source='prepared';state.replayed=0;state.flowCursor=0;state.flowTick=0;state.flowEpoch=Date.now();state.playing=true;state.storeOffset=0;renderStats();consumerMetrics.refresh();});const headings=['部门编码','部门名称','含税销售额','销售数量','客流量'];$('mappingFields').innerHTML=[['门店 / 部门编码','部门编码'],['门店 / 部门名称','部门名称'],['含税销售金额','含税销售额']].map(([label,selected])=>`<div class="mapping-row"><span>${label}</span><select aria-label="${label}对应字段">${headings.map(h=>`<option ${h===selected?'selected':''}>${h}</option>`).join('')}</select></div>`).join('');$('importFile').onchange=e=>{const f=e.target.files[0];$('fileStatus').textContent=f?`已选择 ${f.name} · ${(f.size/1024).toFixed(1)} KB；下方字段为样表映射演示，未解析文件。`:'按实际字段映射，不依赖固定列位置。';$('importResult').textContent='';};$('previewImport').onclick=()=>{const a=new Date($('importStart').value+'T00:00:00Z'),b=new Date($('importEnd').value+'T00:00:00Z'),days=Math.round((b-a)/86400000)+1;if(!Number.isFinite(days)||days<=0){$('importResult').textContent='请填写有效的起止日期，结束日期不能早于开始日期。';return;}const selected=[...$('mappingFields').querySelectorAll('select')].map(x=>x.value);if(new Set(selected).size!==selected.length){$('importResult').textContent='不同业务字段不能映射到同一个来源字段。';return;}if(selected[2]!=='含税销售额'){$('importResult').textContent='销售金额不能使用销售数量或客流量；需确认选定字段的金额含义。';return;}$('importResult').innerHTML=`<p>期间首尾计入：<b>${days} 天</b><br>映射：${selected.join(' / ')}<br>导入规则：忽略空白与合计行，按部门编码匹配，日均基数 = 对应金额 ÷ ${days}。</p><p class="gold">这是映射规则预览，尚未解析或保存所选文件。</p>`;};renderStats();renderMonitor();renderPlans();renderProducts();renderRadar();updateClock();setInterval(updateClock,1000);startTimers();window.addEventListener('resize',()=>Object.values(charts).forEach(c=>c.resize()));if(document.modelContext?.registerTool){const tools=[{name:'read_dashboard_preview',description:'Read the current prototype mode, source date, sales summary and local configuration.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({mode:state.mode,sourceDate:state.day,sales:view().total,config:{...config},prototype:true})},{name:'set_dashboard_preview_mode',description:'Switch between historical real-data preview and historical order replay; no shared data is changed.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['real','demo']}},required:['mode'],additionalProperties:false},execute:input=>{if(!input||!['real','demo'].includes(input.mode))throw new Error('Invalid preview mode');setMode(input.mode);return {mode:state.mode,sales:view().total};}}];for(const tool of tools)try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});}catch{}}}
  if(typeof DASHBOARD_DATA!=='undefined'&&typeof echarts!=='undefined')init();else{$('modeStatus').textContent='资源加载失败，请刷新页面';}
