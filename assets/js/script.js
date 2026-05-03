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
     * MAIN THREE.JS SCENE (Background)   *
     * ─────────────────────────────────── */
    const canvas=document.getElementById('three-canvas');
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.setClearColor(0x000000,0);

    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight,.1,1000);
    camera.position.z=30;

    // Mouse
    let mouseX=0,mouseY=0;
    document.addEventListener('mousemove',e=>{
      mouseX=(e.clientX/window.innerWidth-.5)*2;
      mouseY=-(e.clientY/window.innerHeight-.5)*2;
    });

    /* PARTICLE FIELD */
    const PARTICLES=4000;
    const pGeom=new THREE.BufferGeometry();
    const pPos=new Float32Array(PARTICLES*3);
    const pVel=new Float32Array(PARTICLES*3);
    const pOrig=new Float32Array(PARTICLES*3);
    for(let i=0;i<PARTICLES;i++){
      const i3=i*3;
      const x=(Math.random()-.5)*120;
      const y=(Math.random()-.5)*80;
      const z=(Math.random()-.5)*60;
      pPos[i3]=x; pPos[i3+1]=y; pPos[i3+2]=z;
      pOrig[i3]=x; pOrig[i3+1]=y; pOrig[i3+2]=z;
      pVel[i3]=(Math.random()-.5)*.02;
      pVel[i3+1]=(Math.random()-.5)*.015;
      pVel[i3+2]=(Math.random()-.5)*.01;
    }
    pGeom.setAttribute('position',new THREE.BufferAttribute(pPos,3));
    const pMat=new THREE.PointsMaterial({
      size:.18,
      color:0x00d4ff,
      transparent:true,
      opacity:.55,
      sizeAttenuation:true,
    });
    const particles=new THREE.Points(pGeom,pMat);
    scene.add(particles);

    /* NEURAL NETWORK LINES */
    const lineCount=120;
    const lineGeo=new THREE.BufferGeometry();
    const linePos=new Float32Array(lineCount*2*3);
    for(let i=0;i<lineCount;i++){
      const i6=i*6;
      const ax=(Math.random()-.5)*100;
      const ay=(Math.random()-.5)*70;
      const az=(Math.random()-.5)*50;
      const bx=ax+(Math.random()-.5)*20;
      const by=ay+(Math.random()-.5)*20;
      const bz=az+(Math.random()-.5)*10;
      linePos[i6]=ax; linePos[i6+1]=ay; linePos[i6+2]=az;
      linePos[i6+3]=bx; linePos[i6+4]=by; linePos[i6+5]=bz;
    }
    lineGeo.setAttribute('position',new THREE.BufferAttribute(linePos,3));
    const lineMat=new THREE.LineBasicMaterial({color:0x003344,transparent:true,opacity:.25});
    const lines=new THREE.LineSegments(lineGeo,lineMat);
    scene.add(lines);

    /* FLOATING GEOMETRIC RINGS */
    function makeRing(radius,tube,segments,color,ox,oy,oz){
      const g=new THREE.TorusGeometry(radius,tube,8,segments);
      const m=new THREE.MeshBasicMaterial({color,wireframe:true,transparent:true,opacity:.08});
      const mesh=new THREE.Mesh(g,m);
      mesh.position.set(ox,oy,oz);
      scene.add(mesh);
      return mesh;
    }
    const ring1=makeRing(18,0.06,80,0x00d4ff, 0, 0, -20);
    const ring2=makeRing(12,0.04,64,0x00a8cc, 10,-5,-15);
    const ring3=makeRing(8, 0.03,48,0xff6b35,-8, 6,-10);

    /* CENTRAL ICOSAHEDRON */
    const icoGeo=new THREE.IcosahedronGeometry(5,1);
    const icoMat=new THREE.MeshBasicMaterial({color:0x00d4ff,wireframe:true,transparent:true,opacity:.06});
    const icosahedron=new THREE.Mesh(icoGeo,icoMat);
    icosahedron.position.set(16,-4,0);
    scene.add(icosahedron);

    /* SMALL FLOATING CUBES */
    const cubes=[];
    for(let i=0;i<20;i++){
      const s=Math.random()*.6+.1;
      const g=new THREE.BoxGeometry(s,s,s);
      const m=new THREE.MeshBasicMaterial({
        color:Math.random()>.5?0x00d4ff:0xff6b35,
        wireframe:true,transparent:true,opacity:.12+Math.random()*.1
      });
      const c=new THREE.Mesh(g,m);
      c.position.set((Math.random()-.5)*80,(Math.random()-.5)*60,(Math.random()-.5)*30);
      c.userData={
        rx:(Math.random()-.5)*.02,
        ry:(Math.random()-.5)*.02,
        rz:(Math.random()-.5)*.015,
        fy:(Math.random()-.5)*.008,
        oy:c.position.y
      };
      scene.add(c);
      cubes.push(c);
    }

    /* ANIMATION LOOP */
    let time=0;
    function animate(){
      requestAnimationFrame(animate);
      time+=.008;

      // Drift particles
      for(let i=0;i<PARTICLES;i++){
        const i3=i*3;
        pPos[i3]  +=pVel[i3];
        pPos[i3+1]+=pVel[i3+1];
        pPos[i3+2]+=pVel[i3+2];
        // Bounce back gently
        if(Math.abs(pPos[i3]-pOrig[i3])>8){pVel[i3]*=-1}
        if(Math.abs(pPos[i3+1]-pOrig[i3+1])>6){pVel[i3+1]*=-1}
        if(Math.abs(pPos[i3+2]-pOrig[i3+2])>4){pVel[i3+2]*=-1}
        // Mouse influence
        const mx=pPos[i3]-mouseX*30;
        const my=pPos[i3+1]-mouseY*20;
        const dist=Math.sqrt(mx*mx+my*my);
        if(dist<15){
          pVel[i3]+=mx/dist*.004;
          pVel[i3+1]+=my/dist*.004;
        }
      }
      pGeom.attributes.position.needsUpdate=true;

      // Rotate rings
      ring1.rotation.x=Math.sin(time*.3)*.4;
      ring1.rotation.y=time*.2;
      ring2.rotation.x=time*.15;
      ring2.rotation.z=Math.cos(time*.25)*.3;
      ring3.rotation.y=time*.3;
      ring3.rotation.z=time*.2;

      // Icosahedron
      icosahedron.rotation.x=time*.15;
      icosahedron.rotation.y=time*.2;

      // Floating cubes
      cubes.forEach(c=>{
        c.rotation.x+=c.userData.rx;
        c.rotation.y+=c.userData.ry;
        c.rotation.z+=c.userData.rz;
        c.position.y=c.userData.oy+Math.sin(time+c.userData.oy)*.5;
      });

      // Camera subtle movement
      camera.position.x+=(mouseX*4-camera.position.x)*.04;
      camera.position.y+=(mouseY*3-camera.position.y)*.04;
      camera.lookAt(scene.position);

      // Lines subtle rotation
      lines.rotation.y=time*.03;
      particles.rotation.y=time*.004;

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
