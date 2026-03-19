/**
 * FigurePool — Manages a pool of wireframe human AND dog figures for multi-entity rendering.
 *
 * Extracted from main.js Observatory class. Owns the lifecycle of up to MAX_FIGURES
 * Three.js figure groups, each containing joints, bones, body segments, and aura.
 *
 * Supports two entity types:
 * - 'human': 17-keypoint COCO skeleton (upright biped)
 * - 'dog':   17-keypoint quadruped skeleton (Pomsky-sized)
 */
import * as THREE from 'three';

// ── Human skeleton (COCO 17-keypoint) ──────────────────────────────

export const SKELETON_PAIRS = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

export const BODY_SEGMENT_DEFS = [
  { joints: [5, 11], radius: 0.12 },   // left torso
  { joints: [6, 12], radius: 0.12 },   // right torso
  { joints: [5, 6], radius: 0.1 },     // shoulder bar
  { joints: [11, 12], radius: 0.1 },   // hip bar
  { joints: [5, 7], radius: 0.05 },    // left upper arm
  { joints: [6, 8], radius: 0.05 },    // right upper arm
  { joints: [7, 9], radius: 0.04 },    // left forearm
  { joints: [8, 10], radius: 0.04 },   // right forearm
  { joints: [11, 13], radius: 0.07 },  // left thigh
  { joints: [12, 14], radius: 0.07 },  // right thigh
  { joints: [13, 15], radius: 0.05 },  // left shin
  { joints: [14, 16], radius: 0.05 },  // right shin
  { joints: [0, 0], radius: 0.1, isHead: true },
];

const BONE_TAPER = (() => {
  const tapers = new Map();
  tapers.set('5-6', 1.4);    // shoulder bar
  tapers.set('11-12', 1.3);  // hip bar
  tapers.set('5-11', 1.3);   // left torso
  tapers.set('6-12', 1.3);   // right torso
  tapers.set('5-7', 1.0);    // left upper arm
  tapers.set('6-8', 1.0);    // right upper arm
  tapers.set('11-13', 1.1);  // left thigh
  tapers.set('12-14', 1.1);  // right thigh
  tapers.set('7-9', 0.7);    // left forearm
  tapers.set('8-10', 0.7);   // right forearm
  tapers.set('13-15', 0.8);  // left shin
  tapers.set('14-16', 0.8);  // right shin
  tapers.set('0-1', 0.5);
  tapers.set('0-2', 0.5);
  tapers.set('1-3', 0.4);
  tapers.set('2-4', 0.4);
  return tapers;
})();

// ── Dog skeleton (quadruped 17-keypoint) ───────────────────────────
//  0: nose   1: left ear   2: right ear   3: neck/head back   4: tail tip
//  5: L front shoulder   6: R front shoulder   7: L front elbow   8: R front elbow
//  9: L front paw  10: R front paw  11: L rear hip  12: R rear hip
// 13: L rear stifle  14: R rear stifle  15: L rear paw  16: R rear paw

const DOG_SKELETON_PAIRS = [
  [0, 3],                            // snout → head
  [3, 1], [3, 2],                    // head → ears
  [3, 5], [3, 6],                    // neck → front shoulders
  [5, 6],                            // shoulder bar
  [5, 7], [6, 8],                    // front upper legs
  [7, 9], [8, 10],                   // front lower legs
  [5, 11], [6, 12],                  // spine (shoulders → hips)
  [11, 12],                          // hip bar
  [11, 13], [12, 14],               // rear upper legs
  [13, 15], [14, 16],               // rear lower legs
  [11, 4],                           // hip → tail
];

const DOG_BODY_SEGMENT_DEFS = [
  { joints: [5, 11], radius: 0.06 },  // left spine
  { joints: [6, 12], radius: 0.06 },  // right spine
  { joints: [5, 6], radius: 0.05 },   // shoulder bar
  { joints: [11, 12], radius: 0.05 }, // hip bar
  { joints: [5, 7], radius: 0.025 },  // L front upper leg
  { joints: [6, 8], radius: 0.025 },  // R front upper leg
  { joints: [7, 9], radius: 0.02 },   // L front lower leg
  { joints: [8, 10], radius: 0.02 },  // R front lower leg
  { joints: [11, 13], radius: 0.03 }, // L rear upper leg
  { joints: [12, 14], radius: 0.03 }, // R rear upper leg
  { joints: [13, 15], radius: 0.025 },// L rear lower leg
  { joints: [14, 16], radius: 0.025 },// R rear lower leg
  { joints: [3, 3], radius: 0.05, isHead: true }, // head
];

const DOG_BONE_TAPER = (() => {
  const tapers = new Map();
  tapers.set('0-3', 0.7);     // snout
  tapers.set('1-3', 0.4);     // ear
  tapers.set('2-3', 0.4);     // ear
  tapers.set('3-5', 1.1);     // neck L
  tapers.set('3-6', 1.1);     // neck R
  tapers.set('5-6', 1.3);     // shoulder bar
  tapers.set('5-11', 1.4);    // spine L
  tapers.set('6-12', 1.4);    // spine R
  tapers.set('11-12', 1.2);   // hip bar
  tapers.set('5-7', 0.8);     // front upper legs
  tapers.set('6-8', 0.8);
  tapers.set('7-9', 0.6);     // front lower legs
  tapers.set('8-10', 0.6);
  tapers.set('11-13', 0.9);   // rear upper legs
  tapers.set('12-14', 0.9);
  tapers.set('13-15', 0.7);   // rear lower legs
  tapers.set('14-16', 0.7);
  tapers.set('4-11', 0.35);   // tail
  return tapers;
})();

// ── Shared animation constants ─────────────────────────────────────

const SECONDARY_DELAY = [
  0.12, 0.10, 0.10, 0.08, 0.08,
  0.18, 0.18, 0.14, 0.14, 0.10, 0.10,
  0.20, 0.20, 0.15, 0.15, 0.10, 0.10,
];

const OVERSHOOT = [
  0.02, 0.01, 0.01, 0.01, 0.01,
  0.03, 0.03, 0.05, 0.05, 0.08, 0.08,
  0.02, 0.02, 0.04, 0.04, 0.06, 0.06,
];

// Dog-specific: tail and ears overshoot more
const DOG_SECONDARY_DELAY = [
  0.10, 0.06, 0.06, 0.12, 0.05, // nose, ears, neck, tail (tail very responsive)
  0.18, 0.18, 0.14, 0.14, 0.10, 0.10,
  0.20, 0.20, 0.15, 0.15, 0.10, 0.10,
];

const DOG_OVERSHOOT = [
  0.03, 0.04, 0.04, 0.02, 0.10, // nose, ears bounce, tail wags big
  0.03, 0.03, 0.04, 0.04, 0.06, 0.06,
  0.02, 0.02, 0.04, 0.04, 0.06, 0.06,
];

const MAX_FIGURES = 4;
const MAX_DOG_FIGURES = 2;

// Dog colors — warm amber
const DOG_WIRE_COLOR = 0xffaa44;
const DOG_JOINT_COLOR = 0xffcc66;

const _vecFrom = new THREE.Vector3();
const _vecTo = new THREE.Vector3();
const _vecTarget = new THREE.Vector3();

export class FigurePool {
  constructor(scene, settings, poseSystem) {
    this._scene = scene;
    this._settings = settings;
    this._poseSystem = poseSystem;
    this._figures = [];
    this._dogFigures = [];
    this._maxFigures = MAX_FIGURES;
    this._maxDogFigures = MAX_DOG_FIGURES;
    this._build();
  }

  get figures() { return this._figures; }
  get dogFigures() { return this._dogFigures; }

  // ---- Construction ----

  _build() {
    for (let f = 0; f < this._maxFigures; f++) {
      this._figures.push(this._createFigure());
    }
    for (let f = 0; f < this._maxDogFigures; f++) {
      this._dogFigures.push(this._createDogFigure());
    }
  }

  _createFigure() {
    const group = new THREE.Group();
    this._scene.add(group);
    const wireColor = new THREE.Color(this._settings.wireColor);
    const jointColor = new THREE.Color(this._settings.jointColor);

    // Joints (17 COCO keypoints)
    const joints = [];
    for (let i = 0; i < 17; i++) {
      const isNose = i === 0;
      const size = isNose ? this._settings.jointSize * 0.7 : this._settings.jointSize;
      const geo = new THREE.SphereGeometry(size, 12, 12);
      const mat = new THREE.MeshStandardMaterial({
        color: isNose ? wireColor : jointColor,
        emissive: isNose ? wireColor : jointColor,
        emissiveIntensity: 0.35,
        transparent: true, opacity: 0,
        roughness: 0.3, metalness: 0.2,
      });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.castShadow = true;
      group.add(sphere);
      joints.push(sphere);

      if ([5, 6, 9, 10, 11, 12, 15, 16].includes(i)) {
        const haloGeo = new THREE.SphereGeometry(size * 1.3, 8, 8);
        const haloMat = new THREE.MeshBasicMaterial({
          color: jointColor,
          transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        sphere.add(halo);
        sphere._halo = halo;
        sphere._haloMat = haloMat;

        const glow = new THREE.PointLight(jointColor, 0, 0.8);
        sphere.add(glow);
        sphere._glow = glow;
      }
    }

    // Bones
    const bones = [];
    for (const [a, b] of SKELETON_PAIRS) {
      const taperKey = `${Math.min(a, b)}-${Math.max(a, b)}`;
      const taper = BONE_TAPER.get(taperKey) || 1.0;
      const thick = this._settings.boneThick * taper;
      const topRadius = thick;
      const botRadius = thick * 0.65;
      const geo = new THREE.CylinderGeometry(topRadius, botRadius, 1, 8, 1);
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: wireColor, emissive: wireColor, emissiveIntensity: 0.3,
        transparent: true, opacity: 0, roughness: 0.4, metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      group.add(mesh);
      bones.push({ mesh, a, b, taper });
    }

    // Body segments
    const bodySegments = [];
    for (const seg of BODY_SEGMENT_DEFS) {
      const geo = seg.isHead
        ? new THREE.SphereGeometry(seg.radius, 12, 12)
        : new THREE.CylinderGeometry(seg.radius, seg.radius * 0.85, 1, 8, 1);
      if (!seg.isHead) {
        geo.translate(0, 0.5, 0);
        geo.rotateX(Math.PI / 2);
      }
      const mat = new THREE.MeshStandardMaterial({
        color: wireColor, emissive: wireColor, emissiveIntensity: 0.12,
        transparent: true, opacity: 0, roughness: 0.5, metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      bodySegments.push({ mesh, mat, a: seg.joints[0], b: seg.joints[1], isHead: seg.isHead });
    }

    // Aura
    const auraGeo = new THREE.CylinderGeometry(0.4, 0.3, 1.7, 16, 1, true);
    const auraMat = new THREE.MeshBasicMaterial({
      color: wireColor, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.position.y = 1;
    group.add(aura);

    const personLight = new THREE.PointLight(wireColor, 0, 6);
    personLight.position.y = 1;
    group.add(personLight);

    const prevPositions = [];
    const velocities = [];
    for (let i = 0; i < 17; i++) {
      prevPositions.push(new THREE.Vector3(0, 0, 0));
      velocities.push(new THREE.Vector3(0, 0, 0));
    }

    return {
      group, joints, bones, bodySegments, aura, auraMat, personLight,
      visible: false, prevPositions, velocities,
      _initialized: false, _lastPose: null, _entityType: 'human',
    };
  }

  // ---- Dog figure construction ----

  _createDogFigure() {
    const group = new THREE.Group();
    this._scene.add(group);
    const wireColor = new THREE.Color(DOG_WIRE_COLOR);
    const jointColor = new THREE.Color(DOG_JOINT_COLOR);
    const jSize = this._settings.jointSize * 0.6; // smaller joints for dog

    // Joints (17 quadruped keypoints)
    const joints = [];
    for (let i = 0; i < 17; i++) {
      const isSnout = i === 0;
      const isTail = i === 4;
      const size = isSnout ? jSize * 0.6 : isTail ? jSize * 0.4 : jSize;
      const geo = new THREE.SphereGeometry(size, 10, 10);
      const mat = new THREE.MeshStandardMaterial({
        color: isSnout ? wireColor : jointColor,
        emissive: isSnout ? wireColor : jointColor,
        emissiveIntensity: 0.4,
        transparent: true, opacity: 0,
        roughness: 0.3, metalness: 0.2,
      });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.castShadow = true;
      group.add(sphere);
      joints.push(sphere);

      // Halo glow on paws and key joints
      if ([5, 6, 9, 10, 11, 12, 15, 16].includes(i)) {
        const haloGeo = new THREE.SphereGeometry(size * 1.2, 8, 8);
        const haloMat = new THREE.MeshBasicMaterial({
          color: jointColor,
          transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        sphere.add(halo);
        sphere._halo = halo;
        sphere._haloMat = haloMat;

        const glow = new THREE.PointLight(jointColor, 0, 0.5);
        sphere.add(glow);
        sphere._glow = glow;
      }
    }

    // Bones — dog skeleton pairs
    const boneThick = this._settings.boneThick * 0.6;
    const bones = [];
    for (const [a, b] of DOG_SKELETON_PAIRS) {
      const taperKey = `${Math.min(a, b)}-${Math.max(a, b)}`;
      const taper = DOG_BONE_TAPER.get(taperKey) || 1.0;
      const thick = boneThick * taper;
      const topRadius = thick;
      const botRadius = thick * 0.7;
      const geo = new THREE.CylinderGeometry(topRadius, botRadius, 1, 8, 1);
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: wireColor, emissive: wireColor, emissiveIntensity: 0.35,
        transparent: true, opacity: 0, roughness: 0.4, metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      group.add(mesh);
      bones.push({ mesh, a, b, taper });
    }

    // Body segments — dog proportions
    const bodySegments = [];
    for (const seg of DOG_BODY_SEGMENT_DEFS) {
      const geo = seg.isHead
        ? new THREE.SphereGeometry(seg.radius, 10, 10)
        : new THREE.CylinderGeometry(seg.radius, seg.radius * 0.85, 1, 8, 1);
      if (!seg.isHead) {
        geo.translate(0, 0.5, 0);
        geo.rotateX(Math.PI / 2);
      }
      const mat = new THREE.MeshStandardMaterial({
        color: wireColor, emissive: wireColor, emissiveIntensity: 0.15,
        transparent: true, opacity: 0, roughness: 0.5, metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      bodySegments.push({ mesh, mat, a: seg.joints[0], b: seg.joints[1], isHead: seg.isHead });
    }

    // Aura — low and wide for quadruped
    const auraGeo = new THREE.CylinderGeometry(0.3, 0.25, 0.4, 16, 1, true);
    const auraMat = new THREE.MeshBasicMaterial({
      color: wireColor, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.position.y = 0.2;
    group.add(aura);

    const personLight = new THREE.PointLight(wireColor, 0, 4);
    personLight.position.y = 0.4;
    group.add(personLight);

    const prevPositions = [];
    const velocities = [];
    for (let i = 0; i < 17; i++) {
      prevPositions.push(new THREE.Vector3(0, 0, 0));
      velocities.push(new THREE.Vector3(0, 0, 0));
    }

    return {
      group, joints, bones, bodySegments, aura, auraMat, personLight,
      visible: false, prevPositions, velocities,
      _initialized: false, _lastPose: null, _entityType: 'dog',
    };
  }

  // ---- Per-frame update ----

  update(data, elapsed) {
    const persons = data?.persons || [];
    const vs = data?.vital_signs || {};
    const isPresent = data?.classification?.presence || false;
    const breathBpm = vs.breathing_rate_bpm || 0;
    const breathPulse = breathBpm > 0
      ? Math.sin(elapsed * Math.PI * 2 * (breathBpm / 60)) * 0.012
      : 0;

    // Separate persons by entity type
    const humans = [];
    const dogs = [];
    for (const p of persons) {
      if (p.entity_type === 'dog') dogs.push(p);
      else humans.push(p);
    }

    // Update human figures
    for (let f = 0; f < this._figures.length; f++) {
      const fig = this._figures[f];
      if (f < humans.length && isPresent) {
        const p = humans[f];
        const kps = this._poseSystem.generateKeypoints(p, elapsed, breathPulse);
        this.applyKeypoints(fig, kps, breathPulse, p.position || [0, 0, 0], elapsed, p.pose);
        fig.visible = true;
      } else {
        if (fig.visible) { this.hide(fig); fig.visible = false; }
      }
    }

    // Update dog figures
    for (let f = 0; f < this._dogFigures.length; f++) {
      const fig = this._dogFigures[f];
      if (f < dogs.length && isPresent) {
        const p = dogs[f];
        const kps = this._poseSystem.generateDogKeypoints(p, elapsed, breathPulse);
        this.applyDogKeypoints(fig, kps, breathPulse, p.position || [0, 0, 0], elapsed, p.pose);
        fig.visible = true;
      } else {
        if (fig.visible) { this.hide(fig); fig.visible = false; }
      }
    }
  }

  // ---- Human keypoint application (unchanged) ----

  applyKeypoints(fig, kps, breathPulse, pos, elapsed = 0, pose = 'standing') {
    const lerpFactor = fig._initialized ? 0.18 : 1.0;

    for (let i = 0; i < 17 && i < kps.length; i++) {
      const j = fig.joints[i];
      _vecTarget.set(kps[i][0], kps[i][1], kps[i][2]);

      if (fig._initialized) {
        const prev = fig.prevPositions[i];
        const vel = fig.velocities[i];
        const delay = SECONDARY_DELAY[i];
        const jointLerp = lerpFactor + delay;
        j.position.lerp(_vecTarget, Math.min(jointLerp, 0.95));
        const overshoot = OVERSHOOT[i];
        vel.subVectors(j.position, prev).multiplyScalar(overshoot);
        j.position.add(vel);
        prev.copy(j.position);
      } else {
        j.position.copy(_vecTarget);
        fig.prevPositions[i].copy(_vecTarget);
        fig.velocities[i].set(0, 0, 0);
      }

      j.material.opacity = 0.95;
      const pulseFactor = 1.0 + Math.abs(breathPulse) * 8.0;
      j.material.emissiveIntensity = 0.35 * pulseFactor;
      const baseScale = this._settings.jointSize / 0.04;
      const pulseScale = baseScale * (1.0 + Math.abs(breathPulse) * 3.0);
      j.scale.setScalar(pulseScale);

      if (j._haloMat) j._haloMat.opacity = 0.04 * this._settings.glow * pulseFactor;
      if (j._glow) j._glow.intensity = this._settings.glow * 0.12 * pulseFactor;
    }

    fig._initialized = true;

    for (const bone of fig.bones) {
      const pA = kps[bone.a], pB = kps[bone.b];
      if (pA && pB) {
        if (fig._initialized) {
          const jA = fig.joints[bone.a];
          const jB = fig.joints[bone.b];
          bone.mesh.position.copy(jA.position);
          bone.mesh.scale.set(1, 1, jA.position.distanceTo(jB.position));
          bone.mesh.lookAt(jB.position);
        }
        bone.mesh.material.opacity = 0.85;
        bone.mesh.material.emissiveIntensity = 0.3 + Math.abs(breathPulse) * 2.0;
      }
    }

    for (const seg of fig.bodySegments) {
      if (seg.isHead) {
        const headJoint = fig.joints[seg.a];
        seg.mesh.position.set(headJoint.position.x, headJoint.position.y + 0.05, headJoint.position.z);
        seg.mat.opacity = 0.15;
      } else {
        const jA = fig.joints[seg.a];
        const jB = fig.joints[seg.b];
        if (jA && jB) {
          const len = jA.position.distanceTo(jB.position);
          seg.mesh.position.copy(jA.position);
          seg.mesh.scale.set(1, 1, len);
          seg.mesh.lookAt(jB.position);
          seg.mat.opacity = 0.12;
        }
      }
      seg.mat.emissiveIntensity = 0.1 + Math.abs(breathPulse) * 0.4;
    }

    // Aura
    const hipY = (fig.joints[11].position.y + fig.joints[12].position.y) / 2;
    const cx = (fig.joints[11].position.x + fig.joints[12].position.x) / 2;
    const cz = (fig.joints[11].position.z + fig.joints[12].position.z) / 2;
    fig.aura.position.set(cx, hipY, cz);
    fig.auraMat.opacity = this._settings.aura + Math.abs(breathPulse) * 0.8;
    const auraShape = this._computeAuraShape(fig, pose, breathPulse);
    fig.aura.scale.set(auraShape.scaleX, auraShape.scaleY, auraShape.scaleZ);

    fig.personLight.position.set(pos[0], 1.2, pos[2]);
    fig.personLight.intensity = this._settings.glow * 0.4;
    fig._lastPose = pose;
  }

  // ---- Dog keypoint application ----

  applyDogKeypoints(fig, kps, breathPulse, pos, elapsed = 0, pose = 'walking') {
    const lerpFactor = fig._initialized ? 0.22 : 1.0;

    for (let i = 0; i < 17 && i < kps.length; i++) {
      const j = fig.joints[i];
      _vecTarget.set(kps[i][0], kps[i][1], kps[i][2]);

      if (fig._initialized) {
        const prev = fig.prevPositions[i];
        const vel = fig.velocities[i];
        const delay = DOG_SECONDARY_DELAY[i];
        const jointLerp = lerpFactor + delay;
        j.position.lerp(_vecTarget, Math.min(jointLerp, 0.95));
        const overshoot = DOG_OVERSHOOT[i];
        vel.subVectors(j.position, prev).multiplyScalar(overshoot);
        j.position.add(vel);
        prev.copy(j.position);
      } else {
        j.position.copy(_vecTarget);
        fig.prevPositions[i].copy(_vecTarget);
        fig.velocities[i].set(0, 0, 0);
      }

      j.material.opacity = 0.95;
      const pulseFactor = 1.0 + Math.abs(breathPulse) * 6.0;
      j.material.emissiveIntensity = 0.4 * pulseFactor;
      const baseScale = (this._settings.jointSize * 0.6) / 0.04;
      const pulseScale = baseScale * (1.0 + Math.abs(breathPulse) * 2.0);
      j.scale.setScalar(pulseScale);

      if (j._haloMat) j._haloMat.opacity = 0.05 * this._settings.glow * pulseFactor;
      if (j._glow) j._glow.intensity = this._settings.glow * 0.1 * pulseFactor;
    }

    fig._initialized = true;

    // Bones
    for (const bone of fig.bones) {
      const pA = kps[bone.a], pB = kps[bone.b];
      if (pA && pB) {
        if (fig._initialized) {
          const jA = fig.joints[bone.a];
          const jB = fig.joints[bone.b];
          bone.mesh.position.copy(jA.position);
          bone.mesh.scale.set(1, 1, jA.position.distanceTo(jB.position));
          bone.mesh.lookAt(jB.position);
        }
        bone.mesh.material.opacity = 0.85;
        bone.mesh.material.emissiveIntensity = 0.35 + Math.abs(breathPulse) * 1.5;
      }
    }

    // Body segments
    for (const seg of fig.bodySegments) {
      if (seg.isHead) {
        const headJoint = fig.joints[seg.a]; // joint 3 (neck)
        seg.mesh.position.set(headJoint.position.x, headJoint.position.y + 0.02, headJoint.position.z);
        seg.mat.opacity = 0.15;
      } else {
        const jA = fig.joints[seg.a];
        const jB = fig.joints[seg.b];
        if (jA && jB) {
          seg.mesh.position.copy(jA.position);
          seg.mesh.scale.set(1, 1, jA.position.distanceTo(jB.position));
          seg.mesh.lookAt(jB.position);
          seg.mat.opacity = 0.12;
        }
      }
      seg.mat.emissiveIntensity = 0.12 + Math.abs(breathPulse) * 0.3;
    }

    // Aura — centered on dog body (between shoulders and hips)
    const shoulderY = (fig.joints[5].position.y + fig.joints[6].position.y) / 2;
    const hipY = (fig.joints[11].position.y + fig.joints[12].position.y) / 2;
    const centerY = (shoulderY + hipY) / 2;
    const cx = (fig.joints[5].position.x + fig.joints[12].position.x) / 2;
    const cz = (fig.joints[5].position.z + fig.joints[12].position.z) / 2;
    fig.aura.position.set(cx, centerY, cz);
    fig.auraMat.opacity = (this._settings.aura || 0.04) + Math.abs(breathPulse) * 0.5;

    // Dog aura: wider than tall, stretches along spine
    const spineLen = fig.joints[5].position.distanceTo(fig.joints[11].position);
    const breathMod = 1 + breathPulse * 2;
    fig.aura.scale.set(0.8 * breathMod, 0.6 * breathMod, (spineLen / 0.3) * 0.8 * breathMod);

    // Light at dog height
    fig.personLight.position.set(pos[0], 0.4, pos[2]);
    fig.personLight.intensity = this._settings.glow * 0.3;
    fig._lastPose = pose;
  }

  _computeAuraShape(fig, pose, breathPulse) {
    const lShoulder = fig.joints[5].position;
    const rShoulder = fig.joints[6].position;
    const lHip = fig.joints[11].position;
    const rHip = fig.joints[12].position;
    const nose = fig.joints[0].position;
    const lAnkle = fig.joints[15].position;
    const rAnkle = fig.joints[16].position;

    const shoulderWidth = Math.sqrt(
      (rShoulder.x - lShoulder.x) ** 2 + (rShoulder.z - lShoulder.z) ** 2
    );
    const ankleWidth = Math.sqrt(
      (rAnkle.x - lAnkle.x) ** 2 + (rAnkle.z - lAnkle.z) ** 2
    );
    const maxWidth = Math.max(shoulderWidth, ankleWidth);
    const headY = nose.y;
    const footY = Math.min(lAnkle.y, rAnkle.y);
    const height = headY - footY;

    const baseWidth = 0.44;
    const baseHeight = 1.7;
    const widthRatio = Math.max(0.6, Math.min(2.0, maxWidth / baseWidth));
    const heightRatio = Math.max(0.4, Math.min(1.3, height / baseHeight));
    const breathMod = 1 + breathPulse * 2;

    return {
      scaleX: widthRatio * breathMod,
      scaleY: heightRatio * breathMod,
      scaleZ: widthRatio * breathMod,
    };
  }

  hide(fig) {
    for (const j of fig.joints) {
      j.material.opacity = 0;
      if (j._haloMat) j._haloMat.opacity = 0;
      if (j._glow) j._glow.intensity = 0;
    }
    for (const b of fig.bones) b.mesh.material.opacity = 0;
    for (const seg of fig.bodySegments) seg.mat.opacity = 0;
    fig.auraMat.opacity = 0;
    fig.personLight.intensity = 0;
    fig._initialized = false;
  }

  applyColors(wireColor, jointColor) {
    for (const fig of this._figures) {
      this._applyColorsToFig(fig, wireColor, jointColor);
    }
    // Dog figures keep their own amber color — don't overwrite
  }

  _applyColorsToFig(fig, wireColor, jointColor) {
    for (let i = 0; i < fig.joints.length; i++) {
      const j = fig.joints[i];
      if (i === 0) {
        j.material.color.copy(wireColor);
        j.material.emissive.copy(wireColor);
      } else {
        j.material.color.copy(jointColor);
        j.material.emissive.copy(jointColor);
      }
      if (j._haloMat) j._haloMat.color.copy(jointColor);
      if (j._glow) j._glow.color.copy(jointColor);
    }
    for (const b of fig.bones) {
      b.mesh.material.color.copy(wireColor);
      b.mesh.material.emissive.copy(wireColor);
    }
    for (const seg of fig.bodySegments) {
      seg.mat.color.copy(wireColor);
      seg.mat.emissive.copy(wireColor);
    }
    fig.auraMat.color.copy(wireColor);
    fig.personLight.color.copy(wireColor);
  }
}
