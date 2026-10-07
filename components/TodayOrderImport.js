(function(root){
  'use strict';
  const fields=[['id','订单号 / 流水号',['流水号','单据编号','订单编号','订单号','单据号']],['code','门店编码',['门店编码','门店编号','部门编码']],['amount','实收净销售金额',['实收金额','净销售金额','成交金额','销售金额']],['date','记账 / 业务日期',['记账日期','销售日期','订单日期','营业日期','日期']]];
  const detailFields=[['id','流水号',['流水号','订单号','单据编号']],['line','明细序号',['序号','明细序号','行号']],['sku','商品编码',['商品编码','SKU','sku']],['name','商品名称',['商品名称','商品名']],['unit','单位',['单位','销售单位']],['quantity','销售数量',['销售数量','数量']],['amount','成交金额',['成交金额','实收金额','净销售金额']],['date','记账日期',['记账日期','订单日期','销售日期']]];
  const replayDates=['2026-10-02','2026-10-03'];
  const $=id=>document.getElementById(id), clean=x=>String(x??'').trim();
  const numeric=x=>typeof x==='number'?x:Number(clean(x).replace(/[,，¥￥\s]/g,''));
  const toCents=n=>Math.round((n+Math.sign(n)*Number.EPSILON)*100);
  function dateOf(value){
    if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value);if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}
    const m=clean(value).match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;
  }
  const timeOf=value=>clean(value).match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0]||'—';
  function parseRows(rows,mapping,today,stores,options={}){
    const known=new Map(stores.map(s=>[s.code,s.name])),seen=new Map(),events=[],errors=[];
    const replay=options.mode==='replay';let duplicates=0,ignored=0;
    const pick=(row,key)=>row[mapping[key]];
    for(let i=0;i<rows.length;i++){
      const row=rows[i];if(row.every(x=>x===null||x===undefined||clean(x)===''))continue;
      const id=clean(pick(row,'id')),code=clean(pick(row,'code'));
      // ERP summary/footer rows have no receipt. Never treat them as orders.
      if(!id&&(row.some(x=>/合计|总计/.test(clean(x)))))continue;
      const raw=pick(row,'amount'),amount=numeric(raw),sourceDate=dateOf(pick(row,'date'));
      if(replay&&sourceDate&&!replayDates.includes(sourceDate)){ignored++;continue;}
      if(!id||!known.has(code)||raw===''||raw==null||!Number.isFinite(amount)||!sourceDate||(!replay&&sourceDate!==today)){
        errors.push(`第 ${i+1} 条：${!id?'缺少流水号':!known.has(code)?'门店编码不在确认清单':raw===''||raw==null||!Number.isFinite(amount)?'金额无效':!sourceDate?'记账日期无效':'业务日期不是今日 '+today}`);continue;
      }
      const amountCents=toCents(amount),key=sourceDate+'|'+code+'|'+id,signature=JSON.stringify([code,amountCents,sourceDate]);
      if(seen.has(key)){if(seen.get(key)!==signature)errors.push(`第 ${i+1} 条：相同流水号对应不同金额`);else duplicates++;continue;}
      seen.set(key,signature);
      events.push({id,key,code,name:known.get(code),date:today,sourceDate,time:timeOf(pick(row,'time')??pick(row,'date')),amount:amountCents/100,amountCents,kind:'retail',type:amountCents<0?'零售退单':'零售',detailCount:0});
    }
    events.sort((a,b)=>a.sourceDate.localeCompare(b.sourceDate)||a.time.localeCompare(b.time)||a.code.localeCompare(b.code)||a.id.localeCompare(b.id));
    if(!events.length&&!errors.length)errors.push(replay?'没有10月2日、3日的门店订单':'没有可导入的今日门店订单');
    return {events,errors,duplicates,ignored,amount:events.reduce((sum,e)=>sum+e.amountCents,0)/100};
  }
  function findMapping(headings,definitions){return Object.fromEntries(definitions.map(([key,,aliases])=>[key,headings.findIndex(h=>aliases.includes(clean(h)))]));}
  function parseDetails(rows,mapping,today,events,options={}){
    const errors=[],details=[],receipts=new Map(),seen=new Map(),totals=new Map();let duplicates=0,ignored=0;
    for(const order of events){const key=order.sourceDate+'|'+order.id;if(receipts.has(key))errors.push('同一记账日期的流水号跨门店重复，无法自动关联明细');receipts.set(key,order);order.detailCount=0;}
    if(errors.length)return {details,errors,duplicates,ignored};
    for(let i=0;i<rows.length;i++){
      const row=rows[i];if(row.every(x=>x==null||clean(x)===''))continue;
      const pick=key=>row[mapping[key]],id=clean(pick('id'));
      if(!id&&row.some(x=>/合计|总计/.test(clean(x))))continue;
      const sourceDate=dateOf(pick('date'));
      if(options.mode==='replay'&&sourceDate&&!replayDates.includes(sourceDate)){ignored++;continue;}
      const order=receipts.get(sourceDate+'|'+id),line=clean(pick('line')),amount=numeric(pick('amount')),quantity=numeric(pick('quantity'));
      if(!order||!line||pick('amount')===''||pick('amount')==null||!Number.isFinite(amount)||pick('quantity')===''||pick('quantity')==null||!Number.isFinite(quantity)||!clean(pick('sku'))){errors.push(`明细第 ${i+1} 条：${!order?'原始日期＋流水号无法关联订单':!line?'缺少明细序号':'商品、金额或数量无效'}`);continue;}
      const item={id:line,orderKey:order.key,orderId:id,code:order.code,date:today,sourceDate,time:timeOf(row[mapping.time]),sku:clean(pick('sku')),name:clean(pick('name')),unit:clean(pick('unit')),quantity,amount:toCents(amount)/100,amountCents:toCents(amount)};
      const key=sourceDate+'|'+id+'|'+line,signature=JSON.stringify(item);
      if(seen.has(key)){if(seen.get(key)!==signature)errors.push(`明细第 ${i+1} 条：相同明细序号内容冲突`);else duplicates++;continue;}
      seen.set(key,signature);details.push(item);order.detailCount++;totals.set(order.key,(totals.get(order.key)||0)+item.amountCents);
    }
    for(const order of events){if(!order.detailCount)errors.push(`订单 ${order.id} 缺少明细`);else if(totals.get(order.key)!==order.amountCents)errors.push(`订单 ${order.id} 实收金额与明细成交金额不一致`);}
    return {details,errors,duplicates,ignored};
  }
  function init(stores,todayFn,onApply){
    let workbook=null,detailBook=null,preview=null,masterRevision=0,detailRevision=0;
    const status=text=>{$('todayOrderResult').textContent=text;};
    const invalidate=()=>{preview=null;$('applyTodayOrders').disabled=true;};
    const mode=()=>$('todayOrderMode').value;
    const mapping=()=>Object.fromEntries(fields.map(([key])=>[key,Number($('today-map-'+key).value)]));
    function readSheet(book,sheetId,headerId){if(!book)return;const sheet=book.Sheets[$(sheetId).value],rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true}),header=Math.max(1,Number($(headerId).value)||1);return {rows:rows.slice(header),headings:rows[header-1]||[]};}
    const masterData=()=>readSheet(workbook,'todayOrderSheet','todayOrderHeader');
    function detectHeader(book,sheetId,headerId){const rows=XLSX.utils.sheet_to_json(book.Sheets[$(sheetId).value],{header:1,defval:'',raw:true});const index=rows.slice(0,50).findIndex(row=>row.some(h=>fields[0][2].includes(clean(h)))&&row.some(h=>fields[3][2].includes(clean(h))));if(index>=0)$(headerId).value=index+1;}
    function fillMapping(){invalidate();const data=masterData();if(!data)return;$('todayOrderMapping').replaceChildren();for(const [key,label,candidates]of fields){const row=document.createElement('div');row.className='mapping-row';const span=document.createElement('span');span.textContent=label;const select=document.createElement('select');select.id='today-map-'+key;select.add(new Option('请选择字段','-1'));data.headings.forEach((h,i)=>select.add(new Option(clean(h)||'未命名列 '+(i+1),String(i))));select.value=String(data.headings.findIndex(h=>candidates.includes(clean(h))));select.onchange=invalidate;row.append(span,select);$('todayOrderMapping').append(row);}status('实收金额取订单主表；明细成交金额用于对账，不重复计入销售额。演示模式只选择原始记账日期10月2日、3日的记录。');}
    $('todayOrderFile').onchange=async e=>{const revision=++masterRevision;invalidate();workbook=null;$('todayOrderMapping').replaceChildren();const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024){status('请选择小于20MB的订单主表');return;}try{const parsed=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});if(revision!==masterRevision)return;workbook=parsed;$('todayOrderSheet').replaceChildren();for(const name of workbook.SheetNames)$('todayOrderSheet').add(new Option(name,name));detectHeader(workbook,'todayOrderSheet','todayOrderHeader');fillMapping();}catch{status('订单文件无法解析，请检查Excel或UTF-8 CSV格式');}};
    $('todayDetailFile').onchange=async e=>{const revision=++detailRevision;invalidate();detailBook=null;const file=e.target.files[0];$('todayDetailSheet').replaceChildren();if(!file)return;if(file.size>20*1024*1024){status('请选择小于20MB的明细表');return;}try{const parsed=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});if(revision!==detailRevision)return;detailBook=parsed;for(const name of detailBook.SheetNames)$('todayDetailSheet').add(new Option(name,name));detectHeader(detailBook,'todayDetailSheet','todayDetailHeader');status('明细文件已解析，请重新核对订单与明细预览。');}catch{status('明细文件无法解析，未应用。');}};
    $('todayOrderSheet').onchange=()=>{detectHeader(workbook,'todayOrderSheet','todayOrderHeader');fillMapping();};$('todayOrderHeader').onchange=fillMapping;
    $('todayDetailSheet').onchange=invalidate;$('todayDetailHeader').onchange=invalidate;$('todayOrderMode').onchange=invalidate;
    $('previewTodayOrders').onclick=()=>{
      const data=masterData();if(!data){status('先选择门店订单主表');return;}
      const map=mapping(),columns=Object.values(map);if(columns.some(x=>x<0)||new Set(columns).size!==fields.length){status('必须为四个业务字段选择不同的来源列');return;}
      map.time=data.headings.findIndex(h=>['收款开始时间','收款结束时间','销售时间'].includes(clean(h)));
      const today=todayFn(),options={mode:mode()},result=parseRows(data.rows,map,today,stores,options);
      preview={...result,date:today,mode:mode(),details:[]};
      if(detailBook&&!result.errors.length){
        const data=readSheet(detailBook,'todayDetailSheet','todayDetailHeader'),map=findMapping(data.headings,detailFields),missing=detailFields.filter(([key])=>map[key]<0);
        if(missing.length)preview.errors.push('明细表头缺少：'+missing.map(([,label])=>label).join('、'));
        else {map.time=data.headings.findIndex(h=>clean(h)==='销售时间');const checked=parseDetails(data.rows,map,today,result.events,options);preview.details=checked.details;preview.errors.push(...checked.errors);preview.detailDuplicates=checked.duplicates;}
      }
      status(preview.errors.length?`校验未通过，未应用：\n${preview.errors.slice(0,10).join('\n')}\n共 ${preview.errors.length} 条问题`:`${preview.mode==='replay'?'演示映射':'真实今日'} ${today} · ${preview.events.length} 张订单 · 实收净额 ¥${preview.amount.toFixed(2)}\n${detailBook?'明细 '+preview.details.length+' 条，逐单金额核对一致。':'未提供明细，客单价按订单主表计算。'}\n重复订单 ${preview.duplicates} 条已去重；${preview.ignored} 条不在演示源日期内已跳过。应用时替换整批数据，不重复叠加。`);
      $('applyTodayOrders').disabled=preview.errors.length>0;
    };
    $('applyTodayOrders').onclick=()=>{
      if(!preview||preview.errors.length||preview.date!==todayFn()||preview.mode!==mode()){status('预览已失效，请重新核对订单');return;}
      const batch={date:preview.date,mode:preview.mode,events:preview.events,details:preview.details};
      try{localStorage.setItem('qinshui-today-orders-v1',JSON.stringify(batch));}catch{status('浏览器不能保存订单；已应用本次会话。');}
      onApply(batch);status(`已应用 ${batch.mode==='replay'?'演示':'真实今日'}订单 ${batch.events.length} 张、明细 ${batch.details.length} 条。演示回放原始日期保留，明细不重复累计销售。此导入仅影响当前浏览器；共享发布需更新公共数据。`);
    };
    $('clearTodayOrders').onclick=()=>{localStorage.removeItem('qinshui-today-orders-v1');onApply(null);status('已恢复内置10月2日、3日订单映射今日演示；原始日期保留。');};
  }
  root.TodayOrderImport={init,parseRows,parseDetails,findMapping,dateOf};
})(window);
