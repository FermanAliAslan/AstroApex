/* Shortest surface arcs on the atlas's 1737.4 km lunar reference sphere. */
(() => {
  'use strict';
  const radiusKm = 1737.4;
  const rad = Math.PI / 180;
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit = v => { const length = Math.hypot(...v); return v.map(n => n/length); };
  function surface({lat, lon}) {
    const a = lat*rad, b = lon*rad;
    return [Math.cos(a)*Math.sin(b), Math.sin(a), Math.cos(a)*Math.cos(b)];
  }
  function greatCircle(a,b) {
    const axis = cross(a,b);
    const sine = Math.hypot(...axis);
    const cosine = dot(a,b);
    const angle = Math.atan2(sine,cosine);
    const antipodal = sine < 1e-12 && cosine < 0;
    if (angle < 1e-13) return {points:[a,b], km:0, antipodal:false};
    // Opposite points admit infinitely many equally short great-circle arcs.
    // Choose a stable tangent; elsewhere the two coordinates determine it.
    const tangent = antipodal
      ? unit(cross(Math.abs(a[1]) < 0.8 ? [0,1,0] : [0,0,1],a))
      : unit(cross(axis,a));
    const count = Math.max(2,Math.ceil(angle/(0.5*rad)));
    const points = [a];
    for (let i=1; i<count; i++) {
      const theta = angle*i/count;
      points.push(a.map((n,j) => n*Math.cos(theta)+tangent[j]*Math.sin(theta)));
    }
    points.push(b);
    return {points, km:angle*radiusKm, antipodal};
  }
  function svgNode(name,attrs={}) {
    const node=document.createElementNS('http://www.w3.org/2000/svg',name);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    return node;
  }
  const xy = point => point.x.toFixed(2)+' '+point.y.toFixed(2);
  function orthographic(camera,w,h) {
    const center=surface(camera);
    const right=[Math.cos(camera.lon*rad),0,-Math.sin(camera.lon*rad)];
    const up=cross(center,right);
    return vector => ({
      x:w/2+camera.diameter/2*dot(right,vector),
      y:h/2-camera.diameter/2*dot(up,vector),
      depth:dot(center,vector)
    });
  }
  function mapProjection(mode,w,h) {
    return vector => {
      const lon = Math.atan2(vector[0],vector[2]);
      const lat = Math.atan2(vector[1],Math.hypot(vector[0],vector[2]));
      if (mode === 'flat') return {x:w*(.5+lon/(2*Math.PI)),y:h*(.5-lat/Math.PI),depth:1,lat};
      // Northward distance from the south pole in the 100 × 100 km stereographic inset.
      if (lat > -84*rad) return {x:0,y:0,depth:-1};
      const distance = 2*radiusKm*Math.tan((Math.PI/2+lat)/2);
      return {x:w*(.5+distance*Math.sin(lon)/100),y:h*(.5-distance*Math.cos(lon)/100),depth:1};
    };
  }
  function projectedPath(vectors,project,mode,w,h) {
    const commands=[];
    let prev,previousVector;
    for (let i=0; i<vectors.length; i++) {
      const vector=vectors[i];
      const p=project(vector);
      if (mode==='flat' && Math.abs(vector[1])>1-1e-14) {
        // The pole occupies an entire edge of a cylindrical map; approach and
        // leave at the respective meridians rather than drawing along that edge.
        const next=vectors[i+1] && project(vectors[i+1]);
        const y=vector[1]>0?0:h;
        if (prev) commands.push('L'+xy({x:prev.x,y}));
        if (next) commands.push('M'+xy({x:next.x,y}));
        prev={x:next?.x ?? prev?.x ?? p.x,y,lat:p.lat,depth:1};
        previousVector=vector;
        continue;
      }
      if (mode==='globe' && prev && (prev.depth>=0)!==(p.depth>=0)) {
        // The normalized chord intersection lies exactly on this great circle's limb.
        const t=prev.depth/(prev.depth-p.depth);
        const limb=project(unit(previousVector.map((v,i)=>v+(vector[i]-v)*t)));
        commands.push((p.depth<0?'L':'M')+xy(limb));
        if (p.depth>=0) commands.push('L'+xy(p));
      } else if (p.depth>=0) {
        if (!prev || prev.depth<0) commands.push('M'+xy(p));
        else if (mode==='flat' && Math.abs(Math.abs(p.x-prev.x)-w/2)<1e-7*w && Math.abs(p.lat)>Math.PI/2-rad) {
          // Longitude is undefined at the pole; continue on the other meridian.
          const poleY=p.lat>0?0:h;
          commands.push('L'+xy({x:prev.x,y:poleY}),'M'+xy({x:p.x,y:poleY}),'L'+xy(p));
        } else if (mode==='flat' && Math.abs(p.x-prev.x)>w/2) {
          const edge=p.x<prev.x?w:0;
          const unwrapped=p.x+(edge===w?w:-w);
          const fraction=(edge-prev.x)/(unwrapped-prev.x);
          const y=prev.y+(p.y-prev.y)*(Number.isFinite(fraction)?fraction:0);
          commands.push('L'+xy({x:edge,y}),'M'+xy({x:w-edge,y}),'L'+xy(p));
        } else commands.push('L'+xy(p));
      }
      prev=p;previousVector=vector;
    }
    return commands.join(' ');
  }

  window.createLunarMeasurement = function(stage) {
    const root=svgNode('svg',{class:'atlas-distance-trace','aria-hidden':'true',focusable:'false'});
    const viewport=svgNode('svg',{overflow:'hidden'});
    const casing=svgNode('path',{class:'atlas-arc-casing'});
    const path=svgNode('path',{class:'atlas-arc'});
    const marks=['A','B'].map(label=>{
      const group=svgNode('g',{'data-endpoint':label});
      const disc=svgNode('circle',{r:4.5});
      const text=svgNode('text',{x:8,y:-8});
      text.textContent=label; group.append(disc,text); return group;
    });
    viewport.append(casing,path,...marks);root.append(viewport);stage.append(root);
    let ends=[],route=null;
    function setEndpoints(points) {
      ends=points.map(surface);
      route=ends.length===2?greatCircle(...ends):null;
      if (!route) {
        path.setAttribute('d','');
        casing.setAttribute('d','');
      }
      return route;
    }
    function draw(mode,element,camera) {
      const show=ends.length && (mode!=='globe'||camera);
      root.style.display=show?'':'none';
      if (!show) return;
      const area=element.getBoundingClientRect(), bounds=stage.getBoundingClientRect();
      const w=area.width,h=area.height;
      if (!w||!h) return;
      viewport.setAttribute('x', area.left-bounds.left);
      viewport.setAttribute('y', area.top-bounds.top);
      viewport.setAttribute('width',w); viewport.setAttribute('height',h);
      const project=mode==='globe'?orthographic(camera,w,h):mapProjection(mode,w,h);
      const d=route?projectedPath(route.points,project,mode,w,h):'';
      casing.setAttribute('d',d);path.setAttribute('d',d);
      marks.forEach((mark,i)=>{
        const p=ends[i]&&project(ends[i]);
        if (p && route && mode==='flat' && Math.abs(ends[i][1])>1-1e-14) {
          const neighbor=route.points[i===0?1:route.points.length-2];
          p.x=project(neighbor).x;
        }
        mark.style.display=p && p.depth>=0 && p.x>=0 && p.x<=w && p.y>=0 && p.y<=h?'':'none';
        if (p) mark.setAttribute('transform','translate('+xy(p)+')');
      });
    }
    setEndpoints([]); draw('globe',stage,null);
    return {setEndpoints,draw};
  };
})();
