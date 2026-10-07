(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const types = {
    store: { label: '门店', color: '#ffe551', marker: 'light' },
    canteen: { label: '后勤事业部 / 食堂', color: '#64d6ad', marker: 'light' },
    base: { label: '农产品基地', color: '#72ddb1', icon: 'M0 12V-4M0 0Q-13 1-10-10Q1-10 0 0M0 5Q13 5 11-6Q0-6 0 5' },
    warehouse: { label: '仓库 / 配送中心', color: '#82b9ff', icon: 'M-12-3L0-12L12-3M-10-4V11H10V-4M-6 11V1H6V11M-6 5H6' },
    logistics: { label: '物流节点', color: '#cbacff', icon: 'M-12-7H3V6H-12ZM3-2H9L12 3V6H3M-5 9A3 3 0 1 0-5 3A3 3 0 1 0-5 9M8 9A3 3 0 1 0 8 3A3 3 0 1 0 8 9' },
    farmer: { label: '农户 / 合作社', color: '#eab783', icon: 'M-11 0L0-10L11 0M-8-2V11H8V-2M-3 11V4H3V11' }
  };
  const fallback = { label: '业务点位', color: '#c4dcec', icon: 'M0 12C-17-3-7-13 0-13C7-13 17-3 0 12ZM0-8A4 4 0 1 0 0 0A4 4 0 1 0 0-8' };
  function node(tag, attrs = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function schematicStoreTargets(feature, projection, path, center) {
    const [[x0, y0], [x1, y1]] = path.bounds(feature);
    const reach = Math.max(34, Math.min(x1 - x0, y1 - y0) * .42);
    const angles = [-18, 24, 67, 111, 154, 198, 241, 286, 326].map(value => value * Math.PI / 180);
    return angles.map((angle, index) => {
      const distance = reach * (.72 + (index % 3) * .12);
      let point = null;
      for (let ratio = 1; ratio >= .32; ratio -= .04) {
        const candidate = [center[0] + Math.cos(angle) * distance * ratio, center[1] + Math.sin(angle) * distance * ratio];
        if (d3.geoContains(feature, projection.invert(candidate))) { point = candidate; break; }
      }
      return point;
    }).filter(Boolean);
  }
  function appendSchematicStoreNetwork(parent, feature, projection, path, center, clipId) {
    const [ox, oy] = center;
    const network = node('g', { class: 'schematic-store-network', 'clip-path': `url(#${clipId})`, 'aria-label': '龙港镇区域内黄色门店光点及园区运输流线' });
    const routes = node('g', { class: 'schematic-store-routes' });
    const stores = node('g', { class: 'schematic-store-points' });
    schematicStoreTargets(feature, projection, path, center).forEach(([tx, ty], index) => {
      const dx = tx - ox, dy = ty - oy, distance = Math.max(1, Math.hypot(dx, dy));
      const bend = (index % 2 ? 1 : -1) * Math.min(18, distance * .1);
      const cx = (ox + tx) / 2 - dy / distance * bend, cy = (oy + ty) / 2 + dx / distance * bend;
      const route = `M${ox},${oy}Q${cx},${cy} ${tx},${ty}`;
      routes.append(node('path', { d: route, class: 'schematic-store-route', style: `animation-delay:-${(index * .31).toFixed(2)}s` }));
      const particle = node('circle', { r: 2.2, class: 'store-transport-particle', opacity: .95 });
      particle.append(node('animateMotion', { path: route, dur: `${2.9 + index * .09}s`, begin: `-${(index * .37).toFixed(2)}s`, repeatCount: 'indefinite' }));
      routes.append(particle);
      const point = node('g', { transform: `translate(${tx},${ty})`, class: 'schematic-store', 'data-store-index': index + 1 });
      const halo = node('circle', { r: 6, class: 'schematic-store-halo' });
      halo.append(
        node('animate', { attributeName: 'r', values: '5;11;5', dur: '2.6s', begin: `${(index * .23).toFixed(2)}s`, repeatCount: 'indefinite' }),
        node('animate', { attributeName: 'opacity', values: '.55;.08;.55', dur: '2.6s', begin: `${(index * .23).toFixed(2)}s`, repeatCount: 'indefinite' })
      );
      point.append(halo, node('circle', { r: 3.7, class: 'schematic-store-dot', style: `animation-delay:-${(index * .23).toFixed(2)}s` }));
      stores.append(point);
    });
    network.append(routes, stores);
    parent.append(network);
  }
  function polygonOK(geometry) {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return Array.isArray(polygons) && polygons.length > 0 && polygons.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every(ring =>
      Array.isArray(ring) && ring.length >= 4 && ring.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
    ));
  }
  class QinshuiTownMap {
    constructor(container, data) {
      this.container = container;
      this.uid = 'qinshui-' + Math.random().toString(36).slice(2);
      this.colors = {};
      this.setData(data);
      this.observer = new ResizeObserver(() => this.render());
      this.observer.observe(container);
    }
    static validate(data) {
      const { towns, county, points, settings } = data;
      if (!towns?.features?.length || !county?.features?.length) return settings.boundaryReviewPending?'行政边界已处理，差异待核验；点位坐标系待确认':'缺少沁水县县界及 12 个乡镇真实边界数据';
      if (settings.boundaryCoordinateSystem !== 'WGS84' || settings.boundaryCoordinateSystemConfirmed === false) return '边界坐标系尚未确认，暂不显示地图';
      if (settings.boundaryReviewPending && !settings.boundaryPrototypeUseApproved) return '行政边界差异待核验，尚未确认用于原型';
      if (towns.metadata?.coordinateSystem !== 'WGS84' || county.metadata?.coordinateSystem !== 'WGS84') return '边界文件坐标系与 WGS84 配置不一致，暂不显示地图';
      if (towns.metadata?.status !== 'verified' || county.metadata?.status !== 'verified') return '行政边界数据来源尚未核验';
      if (!towns.metadata.source || !county.metadata.source || !towns.metadata.dataDate || !county.metadata.dataDate) return '请补充边界数据来源及数据日期';
      if (county.features.length !== 1 || county.features[0].properties?.name !== settings.countyName) return '县界文件必须包含一个沁水县完整 Polygon / MultiPolygon';
      if (![...towns.features, ...county.features].every(f => polygonOK(f.geometry))) return '行政边界包含无效或未闭合的几何数据';
      const names = towns.features.map(f => f.properties?.name);
      const missing = settings.expectedTownNames.filter(name => !names.includes(name));
      const extra = names.filter(name => !settings.expectedTownNames.includes(name));
      if (names.length !== 12 || new Set(names).size !== 12 || missing.length || extra.length) return `乡镇数据不完整：缺少 ${missing.join('、') || '无'}；多出或重复 ${extra.join('、') || (new Set(names).size !== names.length ? '重复乡镇' : '无')}`;
      return null;
    }
    static pointIssue({ points, settings }) {
      if (!Array.isArray(points)) return '点位数据格式待核验';
      if (points.length && (settings.pointCoordinateSystem !== 'WGS84' || !(settings.pointCoordinateSystemsConfirmed || settings.coordinateSystemsConfirmed))) return '业务点位坐标系待确认，暂不显示点位';
      const ids = new Set();
      for (const p of points) {
        if (!p.id || !p.name || !p.type || ids.has(p.id) || !Number.isFinite(p.longitude) || !Number.isFinite(p.latitude) || Math.abs(p.longitude) > 180 || Math.abs(p.latitude) > 90 || (p.coordinateSystem && p.coordinateSystem !== 'WGS84') || (p.pointCoordinateSystem && p.pointCoordinateSystem !== 'WGS84')) return '点位标识、经纬度或坐标系待核验，暂不显示点位';
        ids.add(p.id);
      }
      return null;
    }
    // D3 spherical rings use the opposite exterior orientation to RFC 7946.
    // Reverse a deep copy only; original files and original point.town stay intact.
    normalize(feature) {
      const copy = JSON.parse(JSON.stringify(feature));
      const polygons = copy.geometry.type === 'Polygon' ? [copy.geometry.coordinates] : copy.geometry.coordinates;
      for (const poly of polygons) poly.forEach((ring, i) => {
        const large = d3.geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI;
        if ((i === 0 && large) || (i > 0 && !large)) ring.reverse();
      });
      return copy;
    }
    setData(data) {
      this.data = data;
      this.error = QinshuiTownMap.validate(data);
      this.pointError = QinshuiTownMap.pointIssue(data);
      if (!this.error && typeof d3 === 'undefined') this.error = '地图投影依赖未加载';
      if (!this.error) {
        this.towns = data.towns.features.map(f => this.normalize(f));
        this.county = this.normalize(data.county.features[0]);
        this.china = data.china?.metadata?.coordinateSystem === 'WGS84' && data.china.features?.every(f => polygonOK(f.geometry))
          ? { type: 'FeatureCollection', features: data.china.features.map(f => this.normalize(f)) } : null;
        this.pointInfo = (this.pointError ? [] : data.points).map(point => {
          const coordinate = [point.longitude, point.latitude];
          const matches = this.towns.filter(t => d3.geoContains(t, coordinate)).map(t => t.properties.name);
          const inside = d3.geoContains(this.county, coordinate);
          if (data.settings.development && point.town && !matches.includes(point.town)) console.warn('点位所属乡镇与经纬度计算结果不一致', { id: point.id, providedTown: point.town, calculatedTowns: matches });
          if (data.settings.development && !inside) console.warn('点位位于沁水县边界外', { id: point.id });
          return { point, matches, inside };
        });
      }
      this.render();
    }
    labelCenter(feature, path, projection) {
      const centroid = path.centroid(feature);
      const candidates = [centroid, projection(d3.geoCentroid(feature))];
      for (const xy of candidates) if (xy?.every(Number.isFinite) && d3.geoContains(feature, projection.invert(xy))) return xy;
      // For concave areas / disconnected parts, find an interior point nearest
      // the calculated centroid. No hand-authored town label coordinates.
      const [[x0, y0], [x1, y1]] = path.bounds(feature);
      let best, distance = Infinity;
      for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
        const xy = [x0 + (x1 - x0) * i / 40, y0 + (y1 - y0) * j / 40];
        if (d3.geoContains(feature, projection.invert(xy))) {
          const d = (xy[0] - centroid[0]) ** 2 + (xy[1] - centroid[1]) ** 2;
          if (d < distance) { distance = d; best = xy; }
        }
      }
      return best || null;
    }
    placeLabel(feature, path, projection, placed) {
      const center = this.labelCenter(feature, path, projection);
      if (!center) return null;
      const name = feature.properties.name;
      const box = (xy, size) => ({ x0: xy[0] - name.length * size / 2 - 3, x1: xy[0] + name.length * size / 2 + 3, y0: xy[1] - size * .65, y1: xy[1] + size * .65 });
      const free = rect => !placed.some(other => rect.x0 < other.x1 && rect.x1 > other.x0 && rect.y0 < other.y1 && rect.y1 > other.y0);
      const [[x0,y0],[x1,y1]] = path.bounds(feature);
      for (const size of [16,14,12]) {
        let best = null, distance = Infinity;
        const candidates = [center];
        for (let i=1;i<16;i++) for (let j=1;j<16;j++) candidates.push([x0+(x1-x0)*i/16,y0+(y1-y0)*j/16]);
        for (const xy of candidates) {
          const rect = box(xy,size);
          if (!free(rect) || !d3.geoContains(feature,projection.invert(xy))) continue;
          const delta = (xy[0]-center[0])**2+(xy[1]-center[1])**2;
          if (delta<distance) { best={xy,size,box:rect};distance=delta; }
          if (delta===0) break;
        }
        if (best) return best;
      }
      return {xy:center,size:12,box:box(center,12)};
    }
    setTownStatus(statusByName) { this.colors = { ...statusByName }; this.render(); }
    static radarCircle(coordinate, radiusKm = 100) {
      // Great-circle radius using the IUGG mean Earth radius, not a pixel radius.
      return d3.geoCircle().center(coordinate).radius(radiusKm / 6371.0088 * 180 / Math.PI).precision(2)();
    }
    reducedMotion() {
      try { return typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch (_) { return false; }
    }
    parkMarkerScale() {
      const scale = this.data.settings.parkMarkerScale;
      return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : .5;
    }
    markerPulse(radius, min, max, className) {
      const pulse = node('circle', { r: radius, fill: 'none', stroke: 'currentColor', 'stroke-width': 1, class: className });
      if (!this.reducedMotion()) pulse.append(node('animate', { attributeName: 'r', values: `${min};${max};${min}`, dur: '3s', repeatCount: 'indefinite' }),
        node('animate', { attributeName: 'opacity', values: '.55;.1;.55', dur: '3s', repeatCount: 'indefinite' }));
      return pulse;
    }
    drawTerrain(svg,width,height) {
      const terrain=this.data.terrain;
      if(!terrain?.active||terrain.mode!=='decorative'||!terrain.decorativeUseConfirmedByUser)return false;
      // Screen-fitted illustration only. No image-to-geography transform is
      // inferred; all geographic layers keep their independent projection.
      svg.append(node('image',{href:terrain.imageAsset,x:0,y:0,width,height,preserveAspectRatio:'xMidYMid slice',class:'terrain-background','data-georeferenced':'false'}));
      svg.append(node('rect',{x:0,y:0,width,height,class:'terrain-blue-overlay',fill:'#061931','fill-opacity':'.24'}));
      return true;
    }
    drawNational(svg, projection, path) {
      if (!this.china) return;
      // The national polygons and county/towns share exactly one projection.
      // At county scale the supplied national polygons provide nearby context;
      // no provincial-city or prefecture-county datasets are loaded.
      this.nationalProjection = projection;
      const group = node('g', { class: 'national-background', 'aria-label': '全国地理底图，县域视角' });
      for (const feature of this.china.features) group.append(node('path', { d: path(feature) }));
      svg.append(group);
    }
    drawSweep(svg, center, radius, clipId, className) {
      const centered=node('g',{transform:`translate(${center[0]},${center[1]})`});
      const rotor=node('g',{class:'radar-rotor '+className});
      // Angular opacity gives the same fading fan as the reference conic
      // gradient. Each sector is visual decoration, never a geographic polygon.
      const segments=24, span=Math.PI*.36;
      for(let i=0;i<segments;i++){
        const a0=-span+span*i/segments,a1=-span+span*(i+1)/segments;
        const path=`M0,0L${radius*Math.cos(a0)},${radius*Math.sin(a0)}A${radius},${radius} 0 0,1 ${radius*Math.cos(a1)},${radius*Math.sin(a1)}Z`;
        rotor.append(node('path',{d:path,fill:'#22d3ee','fill-opacity':.015+.23*((i+1)/segments)**1.6}));
      }
      rotor.append(node('path',{d:`M0,0L${radius},0`,class:'radar-sweep-ray'}));
      rotor.append(node('animateTransform',{attributeName:'transform',type:'rotate',from:'0',to:'360',dur:`${this.data.settings.radarSweepSeconds||4.2}s`,repeatCount:'indefinite'}));
      centered.append(rotor);
      const clipped=node('g',{'clip-path':`url(#${clipId})`});clipped.append(centered);svg.append(clipped);
    }
    drawRadarPreview(svg, projection, path, width, height) {
      if(!this.data.settings.visualRadarPreviewEnabled)return;
      // The county's real geometric centroid is a visual preview anchor. It is
      // not a warehouse location, an activated business point or a 100 km claim.
      let center=projection(d3.geoCentroid(this.county));
      if(!d3.geoContains(this.county,projection.invert(center)))center=this.labelCenter(this.county,path,projection);
      if(!center)return;
      this.radarPreviewCoordinate=projection.invert(center);
      const radius=Math.min(width,height)*.36,clipId=this.uid+'-preview-clip';
      const defs=node('defs'),clip=node('clipPath',{id:clipId,clipPathUnits:'userSpaceOnUse'});
      clip.append(node('circle',{cx:center[0],cy:center[1],r:radius}));defs.append(clip);svg.append(defs);
      const preview=node('g',{class:'radar-preview','data-preview-only':'true','pointer-events':'none','aria-label':'县域扫描效果预览，尚非园区100公里辐射范围'});
      for(const fraction of [.25,.5,.75,1])preview.append(node('circle',{cx:center[0],cy:center[1],r:radius*fraction,class:'radar-preview-ring'}));
      this.drawSweep(preview,center,radius,clipId,'radar-preview-sweep');
      svg.append(preview);
    }
    radarAnchor(origin) {
      const settings=this.data.settings;
      if(settings.radarCenterMode==='town'){
        const town=this.towns.find(feature=>feature.properties.name===settings.radarCenterTown);
        if(!town)return null;
        let coordinate=d3.geoCentroid(town);
        if(!coordinate.every(Number.isFinite)||!d3.geoContains(town,coordinate)){
          const probe=d3.geoMercator().fitExtent([[0,0],[1000,1000]],town);
          const xy=this.labelCenter(town,d3.geoPath(probe),probe);
          if(!xy)return null;
          coordinate=probe.invert(xy);
        }
        return {coordinate,name:town.properties.name+'中心',mode:'town',basis:'真实行政区几何中心（必要时取内部中心）'};
      }
      return origin?{coordinate:[origin.point.longitude,origin.point.latitude],name:settings.dispatchOriginName||origin.point.name,mode:'dispatch'}:null;
    }
    drawRadar(svg, path, projection, anchor, circle) {
      if (!anchor || !circle) return;
      const radiusKm = this.data.settings.radarRadiusKm || 100;
      const [x,y] = projection(anchor.coordinate);
      const bounds = path.bounds(circle), r = Math.max(bounds[1][0]-bounds[0][0],bounds[1][1]-bounds[0][1])*.7;
      const clipId = this.uid+'-radar-clip';
      const defs = node('defs'), clip = node('clipPath', { id:clipId, clipPathUnits:'userSpaceOnUse' });
      clip.append(node('path',{d:path(circle)}));
      defs.append(clip);
      const anchorTown = this.towns.find(feature => d3.geoContains(feature, anchor.coordinate))
        || this.towns.find(feature => feature.properties.name === this.data.settings.radarCenterTown);
      const townClipId = this.uid+'-anchor-town-clip';
      if (anchorTown) {
        const townClip = node('clipPath', { id: townClipId, clipPathUnits: 'userSpaceOnUse' });
        townClip.append(node('path', { d: path(anchorTown) }));
        defs.append(townClip);
      }
      svg.append(defs);
      const radar = node('g', { class:'geo-radar','data-radius-km':radiusKm,'pointer-events':'none','data-center-name':anchor.name,'data-center-longitude':anchor.coordinate[0],'data-center-latitude':anchor.coordinate[1],'aria-label':`以${anchor.name}为中心，半径${radiusKm}公里` });
      radar.append(node('path',{d:path(circle),class:'radar-area'}));
      for (const distance of [radiusKm*.25,radiusKm*.5,radiusKm*.75,radiusKm]) {
        const ring=QinshuiTownMap.radarCircle(anchor.coordinate,distance);
        radar.append(node('path',{d:path(ring),class:'radar-ring','data-radius-km':distance}));
      }
      this.drawSweep(radar,[x,y],r,clipId,'radar-business-sweep');
      if(anchor.mode==='town'){
        const appearance=this.data.settings.centerMarkerAppearance;
        const hasRealOrigin=this.pointInfo.some(info=>info.point.id===this.data.settings.dispatchOriginId);
        this.radarCenterMarker=node('g',{class:'radar-center-marker','aria-label':anchor.name});
        if(appearance?.symbol==='star'&&!hasRealOrigin){
          // User-requested schematic park label at the town radar anchor. This
          // does not activate or rewrite the UNKNOWN park spreadsheet position.
          this.radarCenterMarker.setAttribute('data-schematic','true');
          this.radarCenterMarker.setAttribute('aria-label',`${appearance.displayName}示意标识；辐射圆心为${anchor.name}`);
          const scale=this.parkMarkerScale();
          if (anchorTown) appendSchematicStoreNetwork(radar, anchorTown, projection, path, [x, y], townClipId);
          const glyph=node('g',{class:'radar-town-center',transform:`translate(${x},${y})`,style:`color:${appearance.color||'#FE0100'}`,'data-marker-scale':scale});
          // D3 symbol size is area. A quarter of the area halves every linear dimension.
          const pulse=this.markerPulse(23*scale,22*scale,35*scale,'center-marker-pulse');
          glyph.append(pulse,node('path',{d:d3.symbol().type(d3.symbolStar).size(600*scale*scale)(),fill:'currentColor',class:'center-park-star'}),node('text',{x:0,y:32,'text-anchor':'middle',class:'park-name'},appearance.displayName));
          this.radarCenterMarker.append(glyph);
        }else{
          this.radarCenterMarker.append(node('circle',{cx:x,cy:y,r:5,fill:'#a2f5ff',stroke:'#2eace2','stroke-width':2,class:'radar-town-center'}));
          if(!this.data.settings.showTownLabels&&!hasRealOrigin)this.radarCenterMarker.append(node('text',{x:x+12,y:y-12,class:'radar-center-label'},anchor.name));
        }
      }
      radar.append(node('text',{x:24,y:this.container.clientHeight-47,'text-anchor':'start',class:'radar-caption'},`${this.data.settings.centerMarkerAppearance?.symbol==='star'?'':anchor.name+' · '}辐射半径 ${radiusKm} km`));
      svg.append(radar);
      this.radarGeometry=circle;
    }
    drawRoutes(svg, projection, origin) {
      if (!origin) return;
      const routes=node('g',{class:'dispatch-routes','pointer-events':'none'}),staticLines=node('g',{class:'static-business-lines'}),dynamicFlows=node('g',{class:'dynamic-business-flows'});
      const [ox,oy]=projection([origin.point.longitude,origin.point.latitude]);
      const targets=this.pointInfo.filter(info=>['store','canteen'].includes(info.point.type)&&info.point.id!==origin.point.id);
      const interval=this.data.settings.routeWaveIntervalSeconds||4,cycle=Math.max(8,Math.ceil(targets.length/4)*interval),fraction=3/cycle;
      targets.forEach((info,index)=>{
        const [tx,ty]=projection([info.point.longitude,info.point.latitude]),distance=Math.hypot(tx-ox,ty-oy);
        if(distance<1)return;
        const bend=Math.min(distance*.16,45),cx=(ox+tx)/2-(ty-oy)/distance*bend,cy=(oy+ty)/2+(tx-ox)/distance*bend;
        const route=`M${ox},${oy}Q${cx},${cy} ${tx},${ty}`,color=this.data.settings.routeColors?.[info.point.type]||(info.point.type==='store'?'#ffe551':'#64d6ad');
        staticLines.append(node('path',{d:route,class:'dispatch-line','data-target-type':info.point.type,style:`stroke:${color}`}));
        for(const inbound of [false,true]){
          const begin=Math.floor(index/4)*interval+(inbound?2:0),dot=node('circle',{r:inbound?2.6:3.5,fill:color,opacity:0,class:`dispatch-dot ${inbound?'dispatch-inbound':'dispatch-outbound'}`});
          dot.append(node('animateMotion',{dur:`${cycle}s`,begin:`${begin}s`,repeatCount:'indefinite',path:route,keyPoints:inbound?'1;0;0':'0;1;1',keyTimes:`0;${fraction};1`,calcMode:'linear'}),node('animate',{attributeName:'opacity',values:inbound?'0;.5;0;0':'0;1;0;0',keyTimes:`0;${fraction*.3};${fraction};1`,dur:`${cycle}s`,begin:`${begin}s`,repeatCount:'indefinite'}));
          dynamicFlows.append(dot);
        }
      });
      routes.append(staticLines,dynamicFlows);svg.append(routes);
    }
    render() {
      if (!this.container) return;
      this.container.replaceChildren();
      if (this.error) {
        const empty = document.createElement('div');
        empty.className = 'map-empty';
        const title = document.createElement('strong'); title.textContent = '沁水县乡镇行政区域地图';
        const message = document.createElement('p'); message.textContent = this.error;
        const detail = document.createElement('p'); detail.textContent = this.data.settings.boundaryReviewPending?'7 镇 · 5 乡｜行政边界检查报告已生成':'7 镇 · 5 乡｜真实经纬度点位待提供';
        empty.append(title, message, detail); this.container.append(empty); return;
      }
      // clientWidth is unscaled CSS size: the LED board scales as one unit.
      const width = this.container.clientWidth, height = this.container.clientHeight;
      if (width < 80 || height < 80) return;
      const origin = this.pointInfo.find(info => info.point.id === this.data.settings.dispatchOriginId);
      const anchor=this.radarAnchor(origin);
      const circle=anchor?QinshuiTownMap.radarCircle(anchor.coordinate,this.data.settings.radarRadiusKm||100):null;
      this.radarCenterCoordinate=anchor?.coordinate||null;
      this.radarGeometry=null;this.radarPreviewCoordinate=null;this.nationalProjection=null;this.radarCenterMarker=null;
      const padding=this.data.settings.mapPadding||{left:48,top:112,right:48,bottom:82};
      const extent=[[padding.left,padding.top],[width-padding.right,height-padding.bottom]];
      const extentFeatures = {type:'FeatureCollection',features:[this.county,...this.towns,
        ...(this.pointInfo.length?[{type:'Feature',properties:{},geometry:{type:'MultiPoint',coordinates:this.pointInfo.map(info=>[info.point.longitude,info.point.latitude])}}]:[]),
        ...(this.data.settings.fitRadarExtent&&circle?[{type:'Feature',geometry:circle,properties:{}}]:[])]};
      const projection = d3.geoMercator().fitExtent(extent, extentFeatures);
      if(anchor&&this.data.settings.centerRadarInViewport){
        // Move the entire shared projection, never the geographic anchor itself.
        const target=[width/2,height/2];
        const recenter=()=>{const xy=projection(anchor.coordinate),t=projection.translate();projection.translate([t[0]+target[0]-xy[0],t[1]+target[1]-xy[1]]);};
        recenter();
        const [[x0,y0],[x1,y1]]=d3.geoPath(projection).bounds(extentFeatures);
        const ratios=[1,
          x0<target[0]?(target[0]-padding.left)/(target[0]-x0):1,
          x1>target[0]?(width-padding.right-target[0])/(x1-target[0]):1,
          y0<target[1]?(target[1]-padding.top)/(target[1]-y0):1,
          y1>target[1]?(height-padding.bottom-target[1])/(y1-target[1]):1];
        const ratio=Math.min(...ratios);
        if(ratio<1){projection.scale(projection.scale()*Math.max(.01,ratio));recenter();}
      }
      this.projection = projection;
      const path = d3.geoPath(projection);
      const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '全国地理底图叠加沁水县12乡镇与经纬度业务点位', class: 'town-map-svg' });
      // Clip all geographic layers to the viewport, including the true 100 km
      // radar circle. Its radius remains geographic when the viewport changes.
      const defs=node('defs'),clip=node('clipPath',{id:this.uid+'-viewport'});
      clip.append(node('rect',{width,height}));defs.append(clip);svg.append(defs);
      const geography=node('g',{'clip-path':`url(#${this.uid}-viewport)`});
      const terrainActive=this.drawTerrain(geography,width,height);
      if(!terrainActive)this.drawNational(geography,projection,path);
      geography.append(node('path',{d:path(this.county),class:'county-shadow'}),node('path',{d:path(this.county),class:'county-outline'}));
      const regions = node('g',{class:'town-regions'});
      const palette = ['#074b7e', '#0b65a1', '#126fa6', '#185c85', '#246d9e', '#164f8d', '#235a98', '#285f89', '#347598', '#205677', '#2d678c', '#17577e'];
      this.towns.forEach((feature, i) => {
        const name = feature.properties.name, status = this.colors[name] || feature.properties.status;
        const townIndex = this.data.settings.expectedTownNames.indexOf(name);
        const customColor = /^#[0-9a-f]{6}$/i.test(feature.properties.color || '') ? feature.properties.color : null;
        const color = this.data.settings.statusColors[status] || customColor || palette[(townIndex < 0 ? i : townIndex) % palette.length];
        const region = node('path', { d: path(feature), fill: color, class: 'town-region', tabindex: 0, role: 'button', 'aria-label': name });
        region.append(node('title', {}, name));
        const select = () => this.container.dispatchEvent(new CustomEvent('townselect', { detail: { name, properties: { ...feature.properties } } }));
        region.onclick = select;
        region.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } };
        regions.append(region);
      });
      geography.append(regions);
      if(anchor)this.drawRadar(geography,path,projection,anchor,circle);
      else this.drawRadarPreview(geography,projection,path,width,height);
      if(this.data.settings.showTownLabels){
        const labels=node('g',{class:'town-labels','pointer-events':'none'}),placed=[];
        const anchors=[...(anchor?[anchor.coordinate]:[]),...this.pointInfo.map(info=>[info.point.longitude,info.point.latitude])];
        for(const coordinate of anchors){const xy=projection(coordinate);placed.push({x0:xy[0]-16,x1:xy[0]+16,y0:xy[1]-16,y1:xy[1]+16});}
        for(const feature of this.towns){
          const result=this.placeLabel(feature,path,projection,placed);
          if(!result)continue;
          placed.push(result.box);
          labels.append(node('text',{x:result.xy[0],y:result.xy[1],'text-anchor':'middle','dominant-baseline':'central',style:`font-size:${result.size}px`},feature.properties.name));
        }
        geography.append(labels);
      }
      const markers = node('g',{class:'business-markers'});
      if(this.radarCenterMarker)markers.append(this.radarCenterMarker);
      const markerOrder=[...this.pointInfo.filter(info=>info!==origin),...(origin?[origin]:[])];
      for (const info of markerOrder) {
        // Legitimate county-exterior business sites stay at their true coordinates.
        const sourcePoint=info.point,isOrigin=sourcePoint.id===origin?.point.id;
        const p=isOrigin?{...sourcePoint,name:this.data.settings.dispatchOriginName||sourcePoint.name}:sourcePoint;
        const scale=isOrigin?this.parkMarkerScale():1;
        const [x, y] = projection([p.longitude, p.latitude]), style = isOrigin?{label:'供应链园区',color:this.data.settings.dispatchOriginColor||'#FE0100',icon:d3.symbol().type(d3.symbolStar).size(500*scale*scale)()}:types[p.type] || fallback;
        const marker = node('g', { transform: `translate(${x},${y})`, class: 'map-marker', 'data-point-id':p.id, 'data-point-type':p.type, 'data-marker-scale':scale, tabindex: 0, role: 'button', 'aria-label': `${p.name}，${style.label}`, style: `color:${style.color}` });
        const light=style.marker==='light';
        const pulse = this.markerPulse(isOrigin?25*scale:light?8:17,isOrigin?22*scale:light?8:15,isOrigin?34*scale:light?14:22,'map-marker-pulse');
        marker.append(pulse);
        if(light){
          const halo=node('circle',{r:9,fill:'currentColor','fill-opacity':.16,class:'business-light-halo'});
          const dot=node('circle',{r:4.5,fill:'currentColor',class:'business-light-point',style:'filter:drop-shadow(0 0 5px currentColor)'});
          if(!this.reducedMotion()){
            halo.append(node('animate',{attributeName:'fill-opacity',values:'.12;.3;.12',dur:'3s',repeatCount:'indefinite'}));
            dot.append(node('animate',{attributeName:'opacity',values:'.75;1;.75',dur:'3s',repeatCount:'indefinite'}));
          }
          marker.append(halo,dot,node('circle',{r:1.4,fill:'#ffffff','fill-opacity':.85,class:'business-light-core'}));
        }else marker.append(node('circle', { r: isOrigin?23*scale:16, fill: '#091726', stroke: 'currentColor', 'stroke-width': isOrigin?1.5*scale:1.5 }),
          node('path', { d: style.icon, fill: isOrigin?'currentColor':'none', stroke: 'currentColor', 'stroke-width': isOrigin?2*scale:2, class:isOrigin?'park-star':'point-icon' }));
        marker.append(node('title', {}, `${p.name} · ${style.label}`));
        if(isOrigin)marker.append(node('text',{x:0,y:32,'text-anchor':'middle',class:'park-name'},p.name));
        const select = () => { this.showPoint(p, style); this.container.dispatchEvent(new CustomEvent('pointselect', { detail: { ...p } })); };
        marker.onclick = select;
        marker.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } };
        markers.append(marker);
      }
      geography.append(markers);this.drawRoutes(geography,projection,origin); svg.append(geography);
      const label=node('text',{x:width-24,y:32,'text-anchor':'end',class:'county-map-label'},'沁水县 · 12乡镇行政区域');
      svg.append(label);
      if(terrainActive&&this.data.settings.showTerrainRegistrationNote!==false)svg.append(node('text',{x:width-24,y:height-48,'text-anchor':'end',class:'terrain-caption'},'地形背景未配准'));
      svg.setAttribute('aria-label','沁水县12乡镇真实行政边界、龙港镇中心与经纬度业务点位'+(terrainActive?'；地形背景为未配准装饰图':''));
      this.container.append(svg);
      if (!origin&&this.data.settings.showStatusNotes!==false) {
        const note = document.createElement('div'); note.className = 'map-point-note';
        note.textContent=this.pointError||(!this.pointInfo.length&&this.data.settings.pendingPointCount?'业务点位坐标系待确认 · 园区雷达待启用':'选择真实园区点位后启用 100 km 雷达');
        if(anchor?.mode==='town')note.textContent=this.pointError||(!this.pointInfo.length&&this.data.settings.pendingPointCount?'业务点位坐标系待确认':'');
        else if(this.radarPreviewCoordinate)note.textContent='扫描效果预览 · 业务点位坐标系待确认';
        if(note.textContent)this.container.append(note);
      }
    }
    showPoint(point, style) {
      this.container.querySelector('.map-point-card')?.remove();
      const card = document.createElement('aside'); card.className = 'map-point-card';
      const name = document.createElement('strong'); name.textContent = point.name;
      const type = document.createElement('p'); type.textContent = style.label;
      const coordinate = document.createElement('p'); coordinate.textContent = `${point.longitude.toFixed(6)}, ${point.latitude.toFixed(6)} · WGS84`;
      const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => card.remove();
      card.append(name, type, coordinate, close); this.container.append(card); close.focus();
    }
    destroy() { this.observer.disconnect(); this.container.replaceChildren(); }
  }
  root.QinshuiTownMap = QinshuiTownMap;
})(globalThis);
