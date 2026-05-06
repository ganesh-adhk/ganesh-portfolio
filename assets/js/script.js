(function(){
    'use strict';
    /* ─── CURSOR ─────────────────────── */
    const cur=document.getElementById('cur');
    const ring=document.getElementById('cur-ring');
    let cx=window.innerWidth/2,cy=window.innerHeight/2;
    let rx=cx,ry=cy;
    document.addEventListener('mousemove',e=>{
      cx=e.clientX;cy=e.clientY;
      cur.style.left=cx+'px';cur.style.top=cy+'px';
    });
    function animRing(){
      rx+=(cx-rx)*.12;ry+=(cy-ry)*.12;
      ring.style.left=rx+'px';ring.style.top=ry+'px';
      requestAnimationFrame(animRing);
    }animRing();

    /* ─── LOADER ─────────────────────── */
    const loader=document.getElementById('loader');
    const lpc=document.getElementById('lpc');
    let pct=0;
    const lti=setInterval(()=>{
      pct=Math.min(pct+(Math.random()*4+1),100);
      lpc.textContent=' '+Math.floor(pct)+'%';
      if(pct>=100){
        clearInterval(lti);
        setTimeout(()=>loader.classList.add('out'),400);
      }
    },60);

    /* ─── NAV SCROLL ─────────────────── */
    const navbar=document.getElementById('navbar');
    window.addEventListener('scroll',()=>{
      navbar.classList.toggle('scrolled',window.scrollY>60);
    });

    /* ─── REVEAL ON SCROLL ────────────── */
    const revEls=document.querySelectorAll('.reveal,.reveal-left,.reveal-right');
    const obs=new IntersectionObserver((entries)=>{
      entries.forEach(e=>{
        if(e.isIntersecting){
          e.target.classList.add('visible');
          // Trigger skill bars
          const bars=e.target.querySelectorAll('.skill-bar-fill');
          bars.forEach(b=>b.classList.add('animated'));
        }
      });
    },{threshold:0.12,rootMargin:'0px 0px -60px 0px'});
    revEls.forEach(el=>obs.observe(el));

    // Separate observer for skill bars in edu section
    const barObs=new IntersectionObserver((entries)=>{
      entries.forEach(e=>{
        if(e.isIntersecting){
          e.target.querySelectorAll('.skill-bar-fill').forEach(b=>b.classList.add('animated'));
        }
      });
    },{threshold:.3});
    document.querySelectorAll('.skill-bars').forEach(el=>barObs.observe(el));

    /* ─────────────────────────────────── *
     * MAIN THREE.JS — Web3 Backdrop      *
     * Hex-lattice "blockchain" mesh,     *
     * dim & sparse so text stays legible *
     * ─────────────────────────────────── */
    const canvas=document.getElementById('three-canvas');
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.setClearColor(0x000000,0);

    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight,.1,1000);
    camera.position.z=30;

    // Web3 palette
    const C_CYAN=0x00f5ff, C_VIOLET=0x8b5cf6, C_MAGENTA=0xff2e8a;

    // Mouse
    let mouseX=0,mouseY=0;
    document.addEventListener('mousemove',e=>{
      mouseX=(e.clientX/window.innerWidth-.5)*2;
      mouseY=-(e.clientY/window.innerHeight-.5)*2;
    });

    /* DRIFTING PARTICLES — sparse, tri-color, additive glow */
    const PARTICLES=1400;
    const pGeom=new THREE.BufferGeometry();
    const pPos=new Float32Array(PARTICLES*3);
    const pCol=new Float32Array(PARTICLES*3);
    const pVel=new Float32Array(PARTICLES*3);
    const pOrig=new Float32Array(PARTICLES*3);
    for(let i=0;i<PARTICLES;i++){
      const i3=i*3;
      const x=(Math.random()-.5)*140;
      const y=(Math.random()-.5)*90;
      const z=(Math.random()-.5)*70-5;
      pPos[i3]=x; pPos[i3+1]=y; pPos[i3+2]=z;
      pOrig[i3]=x; pOrig[i3+1]=y; pOrig[i3+2]=z;
      pVel[i3]=(Math.random()-.5)*.018;
      pVel[i3+1]=(Math.random()-.5)*.013;
      pVel[i3+2]=(Math.random()-.5)*.009;
      const r=Math.random();
      if(r<.55){pCol[i3]=0;pCol[i3+1]=.96;pCol[i3+2]=1.0}        // cyan
      else if(r<.85){pCol[i3]=.55;pCol[i3+1]=.36;pCol[i3+2]=.96} // violet
      else{pCol[i3]=1.0;pCol[i3+1]=.18;pCol[i3+2]=.54}           // magenta
    }
    pGeom.setAttribute('position',new THREE.BufferAttribute(pPos,3));
    pGeom.setAttribute('color',new THREE.BufferAttribute(pCol,3));
    const pMat=new THREE.PointsMaterial({
      size:.16,vertexColors:true,
      transparent:true,opacity:.4,
      blending:THREE.AdditiveBlending,depthWrite:false,
      sizeAttenuation:true,
    });
    const particles=new THREE.Points(pGeom,pMat);
    scene.add(particles);

    /* HEX-LATTICE BLOCKCHAIN MESH — connected nodes far back */
    const lattice=(()=>{
      const cols=8,rows=5,step=18;
      const nodes=[];
      for(let r=0;r<rows;r++){
        for(let c=0;c<cols;c++){
          const x=(c-cols/2+(r%2)*.5)*step;
          const y=(r-rows/2)*step*.866;
          const z=-34+(Math.random()-.5)*10;
          nodes.push(new THREE.Vector3(x,y,z));
        }
      }
      const linePos=[];
      for(let i=0;i<nodes.length;i++){
        for(let j=i+1;j<nodes.length;j++){
          if(nodes[i].distanceTo(nodes[j])<step*1.15){
            linePos.push(nodes[i].x,nodes[i].y,nodes[i].z,
                         nodes[j].x,nodes[j].y,nodes[j].z);
          }
        }
      }
      const lg=new THREE.BufferGeometry();
      lg.setAttribute('position',new THREE.Float32BufferAttribute(linePos,3));
      const lm=new THREE.LineBasicMaterial({
        color:C_VIOLET,transparent:true,opacity:.18,
        blending:THREE.AdditiveBlending,depthWrite:false,
      });
      return{lines:new THREE.LineSegments(lg,lm),nodes};
    })();
    scene.add(lattice.lines);

    // Glowing nodes at lattice points
    const nodeGeom=new THREE.BufferGeometry();
    const nodePos=new Float32Array(lattice.nodes.length*3);
    const nodeCol=new Float32Array(lattice.nodes.length*3);
    lattice.nodes.forEach((n,i)=>{
      nodePos[i*3]=n.x; nodePos[i*3+1]=n.y; nodePos[i*3+2]=n.z;
      const r=Math.random();
      if(r<.5){nodeCol[i*3]=0;nodeCol[i*3+1]=.96;nodeCol[i*3+2]=1.0}
      else{nodeCol[i*3]=.55;nodeCol[i*3+1]=.36;nodeCol[i*3+2]=.96}
    });
    nodeGeom.setAttribute('position',new THREE.BufferAttribute(nodePos,3));
    nodeGeom.setAttribute('color',new THREE.BufferAttribute(nodeCol,3));
    const nodeMesh=new THREE.Points(nodeGeom,new THREE.PointsMaterial({
      size:.55,vertexColors:true,transparent:true,opacity:.7,
      blending:THREE.AdditiveBlending,depthWrite:false,
    }));
    scene.add(nodeMesh);

    /* ORBIT RINGS — minimal, web3 hex feel */
    function makeRing(radius,color,ox,oy,oz,opacity){
      const g=new THREE.TorusGeometry(radius,.05,6,64);
      const m=new THREE.MeshBasicMaterial({color,wireframe:true,transparent:true,opacity});
      const mesh=new THREE.Mesh(g,m);
      mesh.position.set(ox,oy,oz);
      scene.add(mesh);
      return mesh;
    }
    const ring1=makeRing(20,C_CYAN,    0, 0,-20,.1);
    const ring2=makeRing(13,C_VIOLET,  9,-5,-14,.1);
    const ring3=makeRing(8, C_MAGENTA,-9, 6, -8,.1);

    /* CENTRAL "BLOCK" — wireframe icosahedron with violet halo */
    const blockGroup=new THREE.Group();
    const icoMat=new THREE.MeshBasicMaterial({color:C_CYAN,wireframe:true,transparent:true,opacity:.08});
    const icosahedron=new THREE.Mesh(new THREE.IcosahedronGeometry(5.5,1),icoMat);
    blockGroup.add(icosahedron);
    const halo=new THREE.Mesh(
      new THREE.IcosahedronGeometry(7.4,1),
      new THREE.MeshBasicMaterial({color:C_VIOLET,wireframe:true,transparent:true,opacity:.05})
    );
    blockGroup.add(halo);
    blockGroup.position.set(17,-4,-2);
    scene.add(blockGroup);

    /* ANIMATION LOOP */
    let time=0;
    function animate(){
      requestAnimationFrame(animate);
      time+=.008;

      // Drift particles
      for(let i=0;i<PARTICLES;i++){
        const i3=i*3;
        pPos[i3]+=pVel[i3];
        pPos[i3+1]+=pVel[i3+1];
        pPos[i3+2]+=pVel[i3+2];
        if(Math.abs(pPos[i3]-pOrig[i3])>9){pVel[i3]*=-1}
        if(Math.abs(pPos[i3+1]-pOrig[i3+1])>7){pVel[i3+1]*=-1}
        if(Math.abs(pPos[i3+2]-pOrig[i3+2])>5){pVel[i3+2]*=-1}
        const mx=pPos[i3]-mouseX*30;
        const my=pPos[i3+1]-mouseY*20;
        const d=Math.sqrt(mx*mx+my*my);
        if(d<15){
          pVel[i3]+=mx/d*.0035;
          pVel[i3+1]+=my/d*.0035;
        }
      }
      pGeom.attributes.position.needsUpdate=true;

      ring1.rotation.x=Math.sin(time*.3)*.4;
      ring1.rotation.y=time*.18;
      ring2.rotation.x=time*.12;
      ring2.rotation.z=Math.cos(time*.25)*.3;
      ring3.rotation.y=time*.28;
      ring3.rotation.z=time*.18;

      blockGroup.rotation.x=time*.13;
      blockGroup.rotation.y=time*.18;
      halo.rotation.x=-time*.18;

      camera.position.x+=(mouseX*4-camera.position.x)*.04;
      camera.position.y+=(mouseY*3-camera.position.y)*.04;
      camera.lookAt(scene.position);

      lattice.lines.rotation.z=time*.02;
      nodeMesh.rotation.z=time*.02;
      particles.rotation.y=time*.003;

      renderer.render(scene,camera);
    }
    animate();

    /* ─────────────────────────────────── *
     * MINI HERO CANVAS — Rotating Torus  *
     * ─────────────────────────────────── */
    const miniCanvas=document.getElementById('hero-canvas-mini');
    if(miniCanvas){
      const mr=new THREE.WebGLRenderer({canvas:miniCanvas,antialias:true,alpha:true});
      mr.setPixelRatio(Math.min(window.devicePixelRatio,2));
      mr.setSize(320,320);
      mr.setClearColor(0x000000,0);
      const ms=new THREE.Scene();
      const mc=new THREE.PerspectiveCamera(50,1,.1,100);
      mc.position.z=8;

      // Outer torus knot
      const tkg=new THREE.TorusKnotGeometry(2.5,0.55,180,20,2,3);
      const tkm=new THREE.MeshBasicMaterial({color:0x00d4ff,wireframe:true,transparent:true,opacity:.7});
      const tk=new THREE.Mesh(tkg,tkm);
      ms.add(tk);

      // Inner icosahedron
      const ig=new THREE.IcosahedronGeometry(1.2,1);
      const im=new THREE.MeshBasicMaterial({color:0xff6b35,wireframe:true,transparent:true,opacity:.5});
      const ico2=new THREE.Mesh(ig,im);
      ms.add(ico2);

      // Orbit ring
      const og=new THREE.TorusGeometry(3.5,0.015,8,120);
      const om=new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:.3});
      const orb=new THREE.Mesh(og,om);
      orb.rotation.x=Math.PI/2;
      ms.add(orb);

      // Orbit particles
      const opCount=60;
      const opG=new THREE.BufferGeometry();
      const opP=new Float32Array(opCount*3);
      for(let i=0;i<opCount;i++){
        const a=(i/opCount)*Math.PI*2;
        opP[i*3]=Math.cos(a)*3.5;
        opP[i*3+1]=0;
        opP[i*3+2]=Math.sin(a)*3.5;
      }
      opG.setAttribute('position',new THREE.BufferAttribute(opP,3));
      const opM=new THREE.PointsMaterial({size:.08,color:0x00d4ff,transparent:true,opacity:.9});
      const opMesh=new THREE.Points(opG,opM);
      ms.add(opMesh);

      let mt=0;
      function mAnim(){
        requestAnimationFrame(mAnim);
        mt+=.012;
        tk.rotation.x=mt*.5;
        tk.rotation.y=mt*.7;
        ico2.rotation.x=-mt*.8;
        ico2.rotation.z=mt*.6;
        opMesh.rotation.y=mt*.4;
        orb.rotation.y=mt*.4;
        mr.render(ms,mc);
      }
      mAnim();
    }

    /* ─── WINDOW RESIZE ──────────────── */
    window.addEventListener('resize',()=>{
      camera.aspect=window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth,window.innerHeight);
    });

    /* ─── SMOOTH FORM SUBMIT ─────────── */
    document.querySelector('.form-submit')?.addEventListener('click',function(){
      const btn=this;
      btn.textContent='✓ Sent!';
      btn.style.background='linear-gradient(135deg,#00a86b,#00d4a8)';
      setTimeout(()=>{
        btn.textContent='✉ Send Message';
        btn.style.background='';
      },3000);
    });

})();
