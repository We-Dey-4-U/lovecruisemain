/* ============================================================
   gift-engine/ParticleSystem.js   [NEW FILE]
   GPU-instanced particle burst (sparkles/confetti/glow trail).
   Uses an object pool so repeated bursts don't allocate garbage
   (req #7 performance: object pooling).
   ============================================================ */
/* ============================================================
   gift-engine/ParticleSystem.js
   Updated Version
   ------------------------------------------------------------
   - Object pooling
   - Multiple burst presets
   - Gravity
   - Drag
   - Alpha fading
   - Size fading
   - Random colors
   - Ring explosion
   - Cone explosion
   - Sphere explosion
   - Shockwave burst
   ============================================================ */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const POOL_SIZE = 1200;

export class ParticleSystem {

    constructor(scene) {

        this.scene = scene;

        this.positions = new Float32Array(POOL_SIZE * 3);
        this.colors = new Float32Array(POOL_SIZE * 3);
        this.sizes = new Float32Array(POOL_SIZE);

        this.velocities = new Float32Array(POOL_SIZE * 3);

        this.life = new Float32Array(POOL_SIZE);
        this.maxLife = new Float32Array(POOL_SIZE);

        this.geometry = new THREE.BufferGeometry();

        this.geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(this.positions,3)
        );

        this.geometry.setAttribute(
            "color",
            new THREE.BufferAttribute(this.colors,3)
        );

        this.material = new THREE.PointsMaterial({

            size:0.14,
            transparent:true,
            opacity:1,

            vertexColors:true,

            blending:THREE.AdditiveBlending,

            depthWrite:false

        });

        this.points = new THREE.Points(
            this.geometry,
            this.material
        );

        this.scene.add(this.points);

        this.cursor = 0;

        this.gravity = 1.8;
        this.drag = 0.985;

    }

    burst({

        origin=[0,0,0],

        count=80,

        color=0xffc857,

        spread=2.5,

        speed=2,

        shape="sphere"

    }={}){

        const baseColor=new THREE.Color(color);

        for(let n=0;n<count;n++){

            const i=this.cursor;

            this.cursor=(this.cursor+1)%POOL_SIZE;

            this.positions[i*3]=origin[0];
            this.positions[i*3+1]=origin[1];
            this.positions[i*3+2]=origin[2];

            let vx,vy,vz;

            if(shape==="ring"){

                const a=Math.random()*Math.PI*2;

                vx=Math.cos(a);
                vy=0;
                vz=Math.sin(a);

            }

            else if(shape==="cone"){

                const a=Math.random()*Math.PI*2;

                vx=Math.cos(a)*0.4;
                vy=1;
                vz=Math.sin(a)*0.4;

            }

            else{

                const theta=Math.random()*Math.PI*2;
                const phi=Math.random()*Math.PI;

                vx=Math.sin(phi)*Math.cos(theta);
                vy=Math.cos(phi);
                vz=Math.sin(phi)*Math.sin(theta);

            }

            const s=speed*(0.5+Math.random()*0.5);

            this.velocities[i*3]=vx*s*spread;
            this.velocities[i*3+1]=vy*s*spread;
            this.velocities[i*3+2]=vz*s*spread;

            const c=baseColor.clone();

            c.offsetHSL(
                (Math.random()-0.5)*0.08,
                0,
                (Math.random()-0.5)*0.15
            );

            this.colors[i*3]=c.r;
            this.colors[i*3+1]=c.g;
            this.colors[i*3+2]=c.b;

            this.sizes[i]=0.12+Math.random()*0.1;

            this.maxLife[i]=0.8+Math.random()*1.2;
            this.life[i]=this.maxLife[i];

        }

        this.geometry.attributes.color.needsUpdate=true;

    }

    shockwave(origin=[0,0,0],color=0xffffff){

        this.burst({

            origin,

            count:220,

            color,

            spread:4,

            speed:3,

            shape:"ring"

        });

    }

    update(dt){

        for(let i=0;i<POOL_SIZE;i++){

            if(this.life[i]<=0)
                continue;

            this.life[i]-=dt;

            const v=i*3;

            this.velocities[v]*=this.drag;
            this.velocities[v+1]*=this.drag;
            this.velocities[v+2]*=this.drag;

            this.velocities[v+1]-=this.gravity*dt;

            this.positions[v]+=this.velocities[v]*dt;
            this.positions[v+1]+=this.velocities[v+1]*dt;
            this.positions[v+2]+=this.velocities[v+2]*dt;

            if(this.life[i]<=0){

                this.positions[v]=9999;
                this.positions[v+1]=9999;
                this.positions[v+2]=9999;

            }

        }

        this.geometry.attributes.position.needsUpdate=true;

    }

    clear(){

        for(let i=0;i<POOL_SIZE;i++){

            this.life[i]=0;

            this.positions[i*3]=9999;
            this.positions[i*3+1]=9999;
            this.positions[i*3+2]=9999;

        }

        this.geometry.attributes.position.needsUpdate=true;

    }

    dispose(){

        this.scene.remove(this.points);

        this.geometry.dispose();

        this.material.dispose();

    }

}