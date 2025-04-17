import * as THREE from 'three';
import {
	computeBoundsTree, disposeBoundsTree, acceleratedRaycast,
} from 'three-mesh-bvh';

// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const svgNS = 'http://www.w3.org/2000/svg';

import EventEmitter from './EventEmitter';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { SVGTexture } from './SVGTexture';


export class SVGDecals extends EventEmitter {
    private scene: THREE.Scene;
    private mainModel: THREE.Object3D | null = null;
    private modelGroup: THREE.Group = new THREE.Group();
    private raycaster = new THREE.Raycaster();
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private svgElement: SVGSVGElement | null = null;
    private maxAttemps = 10;
    private dragging = false;
    private rotating = false;
    private scaling = false;
    private updating = false;
    private startDragCoordinates: THREE.Vector2 | null = null;
    private savedRotateAngle: number = 0;
    private startRotateAngle: number = 0;
    private savedScale: number = 0;
    private distanceFromCenterOnStart: number = 0;
    private startScalePos: {x: number, y: number} = {x: 0, y: 0};
    private startScaleCenter: {x: number, y: number} = {x: 0, y: 0};
    private decalSVGInitial = `
            <svg xmlns="${svgNS}" width="2048" height="2048" fill="none" viewBox="0 0 2048 2048" version="1.1" xml:space="preserve">
                <style>
                    .dashed-border {
                        outline: 1px dashed black;
                    }
                    [name="controls"] {
                        display: none;
                    }
                    [active="true"] [name="controls"] {
                        display: block;
                    }
                </style>
            </svg>
        `;
    private decalMaterial: THREE.MeshStandardMaterial;
    private decalSVGTexture: SVGTexture | null = null;

    constructor(scene: THREE.Scene, model: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls, renderer: THREE.WebGLRenderer) {
        super();
        this.scene = scene;
        this.mainModel = model;
        this.camera = camera;
        this.renderer = renderer;
        this.controls = controls;
        this.raycaster.firstHitOnly = true;

        this.scene.add(this.modelGroup);
        this.modelGroup.name = 'MergeMaterialsGroup';
        this.decalMaterial = new THREE.MeshStandardMaterial({
            name: 'decalMaterial',
            transparent: true,
            opacity: 1,
            visible: true,
        });
        this.decalSVGTexture = new SVGTexture(this.decalSVGInitial, this.decalMaterial);

        console.time('computeBoundsTree');

        this.mainModel.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const baseMesh = child.clone();

                baseMesh.material = child.material.clone();
                this.modelGroup.add(baseMesh);

                const decalMesh = child.clone();

                decalMesh.material = this.decalMaterial;
                decalMesh.material.map.flipY = false;
                
                this.modelGroup.add(decalMesh);

                baseMesh.geometry.computeBoundsTree();
                decalMesh.geometry.computeBoundsTree();

                // Remove the original mesh from the scene to avoid duplicates
                child.geometry.dispose();

                if (Array.isArray(child.material)) {
                    child.material.forEach((material) => material.dispose());
                } else {
                    child.material.dispose();
                }
                this.scene.remove(child);
            }
        });

        this.scene.remove(this.mainModel);

        console.timeEnd('computeBoundsTree');

        this.svgElement = this.decalSVGTexture?.getSVGElement() || null;
        this.initEventListeners();
    }

    private initEventListeners() {
        window.addEventListener('mousedown', (event: MouseEvent) => {
            if (!this.svgElement) return;

            this.startScalePos = {x: event.clientX, y: event.clientY};

            const intersects = this.getMouseIntersections(event);
            const decalIntersected = this.selectDecalByClickedPosition(intersects);
            const controlIntersected = this.useControlByClickedPosition(intersects);
            const contentIntersected = this.useContentByClickedPosition(intersects);
            const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);


            console.log('this.startScalePos', this.startScalePos)
            console.log('controlIntersected', controlIntersected);
            console.log('contentIntersected', contentIntersected);

            this.dragging = decalIntersected && contentIntersected !== null;
            this.rotating = decalIntersected && controlIntersected !== null && controlIntersected.getAttribute('name') === 'control-rotate-icon';
            this.scaling = decalIntersected && controlIntersected !== null && controlIntersected.getAttribute('name') === 'control-scale-icon';
            this.controls.enablePan = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableZoom = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableRotate = !this.dragging && !this.rotating && !this.scaling;

            this.decalSVGTexture?.updateSVGTexture();

            if (decalIntersected) {
                const activeDecal = this.svgElement.querySelector('g[name*="decal"][active="true"]') as SVGGraphicsElement | null;
                
                if (!activeDecal) return;

                const actualProps = this.getDecalProperties(activeDecal);

                this.emit('update', [{ 
                    event, 
                    updatedSVGContent, 
                    dragging: this.dragging,
                    rotating: this.rotating,
                    scaling: this.scaling,
                    props: actualProps
                }]);
            }
        });

        window.addEventListener('mousemove', (event: MouseEvent) => {
            if (this.updating) return;

            this.controls.enablePan = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableZoom = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableRotate = !this.dragging && !this.rotating && !this.scaling;

            if (this.dragging || this.rotating || this.scaling) {
                this.updating = true;

                console.time('dragging');

                let updatedSVGContent: string | null = null;

                if (this.dragging) {
                    updatedSVGContent = this.handleDragDecal(event);
                } else if (this.rotating) {
                    updatedSVGContent = this.handleRotateDecal(event);
                } else if (this.scaling) {
                    updatedSVGContent = this.handleScaleDecal(event);
                }
                

                console.timeLog('dragging', 'updatedSVGContent');

                if (updatedSVGContent) {
                    const activeDecal = this.svgElement?.querySelector('g[name*="decal"][active="true"]') as SVGGraphicsElement | null;
                
                    if (!activeDecal) return;

                    const actualProps = this.getDecalProperties(activeDecal);

                    this.decalSVGTexture?.updateSVGTexture(() => {
                        console.timeEnd('dragging');

                        requestAnimationFrame(() => {
                            this.updating = false;
                        });
                    });
                    this.emit('update', [{ 
                        event, 
                        updatedSVGContent, 
                        dragging: this.dragging,
                        rotating: this.rotating,
                        scaling: this.scaling,
                        props: actualProps
                    }]);

                    console.timeLog('dragging', 'this.emit update');
                } else {
                    requestAnimationFrame(() => {
                        this.updating = false;
                    });
                }
            }
        });
        window.addEventListener('mouseup', (event) => {
            this.dragging = false;
            this.rotating = false;
            this.scaling = false;
            this.controls.enablePan = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableZoom = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableRotate = !this.dragging && !this.rotating && !this.scaling;

            this.decalSVGTexture?.updateSVGTexture();

            this.emit('update', [{ event, dragging: this.dragging }]);
        });
    }


    private getMouseIntersections(event: MouseEvent): THREE.Intersection[] {
        if (!(event.target instanceof HTMLCanvasElement)) return [];

        console.time('getMouseIntersections');

        const mouse = new THREE.Vector2();
        const rect = event.target.getBoundingClientRect();

        console.timeLog('getMouseIntersections', 'getBoundingClientRect');
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(mouse, this.camera);
        this.raycaster.firstHitOnly = true;

        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        console.timeEnd('getMouseIntersections');

        return intersects;
    }

    private uvToBarycentric(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): THREE.Vector3 | null {
        const v0 = b.clone().sub(a);
        const v1 = c.clone().sub(a);
        const v2 = p.clone().sub(a);
      
        const d00 = v0.dot(v0);
        const d01 = v0.dot(v1);
        const d11 = v1.dot(v1);
        const d20 = v2.dot(v0);
        const d21 = v2.dot(v1);
        const denom = d00 * d11 - d01 * d01;
      
        if (denom === 0) return null;
      
        const v = (d11 * d20 - d01 * d21) / denom;
        const w = (d00 * d21 - d01 * d20) / denom;
        const u = 1 - v - w;
      
        return new THREE.Vector3(u, v, w);
    }

    private getMeshPointByUV(object: THREE.Object3D, uv: THREE.Vector2): THREE.Vector3 {
        const position = new THREE.Vector3();

        if (object instanceof THREE.Mesh && object.geometry.attributes.uv) {
            const posAttr = object.geometry.attributes.position;
            const uvAttr = object.geometry.attributes.uv;
            const indexAttr = object.geometry.index;

            if (!posAttr || !uvAttr) return position;

            const triangle = [0, 0, 0]; // Indices
            const uvA = new THREE.Vector2(), uvB = new THREE.Vector2(), uvC = new THREE.Vector2();
            const posA = new THREE.Vector3(), posB = new THREE.Vector3(), posC = new THREE.Vector3();

            const triangleCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

            console.time('getMeshPointByMeshUV');

            for (let i = 0; i < triangleCount; i++) {
                // Get triangle vertex indices
                for (let j = 0; j < 3; j++) {
                triangle[j] = indexAttr ? indexAttr.getX(i * 3 + j) : i * 3 + j;
                }

                // Get triangle UVs
                uvA.fromBufferAttribute(uvAttr, triangle[0]);
                uvB.fromBufferAttribute(uvAttr, triangle[1]);
                uvC.fromBufferAttribute(uvAttr, triangle[2]);

                // Check if UV is inside this triangle
                const barycoord = this.uvToBarycentric(uv, uvA, uvB, uvC);
                if (barycoord && barycoord.x >= 0 && barycoord.y >= 0 && barycoord.z >= 0) {
                    console.timeEnd('getMeshPointByMeshUV');

                    // Interpolate position using barycentric coords
                    posA.fromBufferAttribute(posAttr, triangle[0]);
                    posB.fromBufferAttribute(posAttr, triangle[1]);
                    posC.fromBufferAttribute(posAttr, triangle[2]);

                    return object.localToWorld(new THREE.Vector3()
                        .addScaledVector(posA, barycoord.x)
                        .addScaledVector(posB, barycoord.y)
                        .addScaledVector(posC, barycoord.z));
                }
            }

            console.timeEnd('getMeshPointByMeshUV');

            return position; // UV not found in any triangle

        }

        return position;
    }

    private reverseRaycast(scenePoint: THREE.Vector3): THREE.Vector2 {
        const canvas = this.renderer.domElement;

        const point = scenePoint.clone();
        
        point.project( this.camera );

        const screenPoint = new THREE.Vector2();
        
        screenPoint.x = Math.round(( 0.5 + point.x / 2 ) * ( canvas.width / this.renderer.getPixelRatio() ));
        screenPoint.y = Math.round(( 0.5 - point.y / 2 ) * ( canvas.height / this.renderer.getPixelRatio() ));

        return screenPoint;
    }


    private getIntersectionUVCoordinates(intersected: THREE.Intersection | undefined): THREE.Vector2 | null {
        if (intersected?.uv) {
            return intersected.uv.clone();
        }
        return null;
    }
    

    private getElementBBox(element: SVGGraphicsElement, decal: SVGElement, scaled: boolean): DOMRect | null {
        if (!(element instanceof SVGGraphicsElement)) return null;

        const bbox = element?.getBBox({stroke: true});

        if (!scaled) return bbox;

        const scaleFactor = parseFloat(decal.getAttribute('scale') || '1');
        const initialWidth = bbox.width;
        const initialHeight = bbox.height;

        bbox.width *= scaleFactor;
        bbox.height *= scaleFactor;

        bbox.x -= (bbox.width - initialWidth) / 2;
        bbox.y -= (bbox.height - initialHeight) / 2;

        return bbox;
    }

    private getDecalProperties(decal: SVGGraphicsElement): { text: string, color: string, scale: number, rotate: number, x: number, y: number } {
        const textElement = decal.querySelector('[name="text"]') as SVGGraphicsElement;
        const text = textElement?.textContent || '';
        const color = decal.getAttribute('fill') || 'black';
        const scale = parseFloat(decal.getAttribute('scale') || '1');
        const rotate = parseFloat(decal.getAttribute('rotate') || '0');
        const x = parseFloat(decal.getAttribute('posX') || '0');
        const y = parseFloat(decal.getAttribute('posY') || '0');

        return { text, color, scale, rotate, x, y };
    }


    private getDecalElementByUV(uv: THREE.Vector2): Element | null {
        if (!this.svgElement) return null;

        const decals = this.svgElement.querySelectorAll(`[name*="decal"]`);

        for (const decal of decals) {
            if (decal instanceof SVGGraphicsElement) {    
                const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
                const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
                const xPos = uv.x * svgWidth;
                const yPos = uv.y * svgHeight;
                const bbox = decal.getBBox();

                if (xPos >= bbox.x && xPos <= bbox.x + bbox.width && yPos >= bbox.y && yPos <= bbox.y + bbox.height) {
                    return decal;
                }
            }
        }

        return null;
    }


    private getControlElementByUV(uv: THREE.Vector2): Element | null {
        if (!this.svgElement) return null;

        const activeDecalControlElement = this.svgElement.querySelector('[name*="decal"][active="true"] [name="controls"]');
        const buttons = activeDecalControlElement?.querySelectorAll('[name*="control-"]');

        for (const button of buttons || []) {
            if (this.svgElement && button instanceof SVGGraphicsElement) {
                const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
                const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
                const xPos = uv.x * svgWidth;
                const yPos = uv.y * svgHeight;
                const bbox = button.getBBox();
                const transform = activeDecalControlElement?.getAttribute('transform');
                const buttonTransform = button.getAttribute('transform');
                let translateX = 0, translateY = 0;

                if (transform) {
                    const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
                    if (match) {
                        translateX = parseFloat(match[1]) || 0;
                        translateY = parseFloat(match[2]) || 0;
                    }
                }
                if (buttonTransform) {
                    const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(buttonTransform);
                    if (match) {
                        translateX += parseFloat(match[1]) || 0;
                        translateY += parseFloat(match[2]) || 0;
                    }
                }

                bbox.x += translateX;
                bbox.y += translateY;

                if (xPos >= bbox.x && xPos <= bbox.x + bbox.width && yPos >= bbox.y && yPos <= bbox.y + bbox.height) {
                    return button;
                }
            }
        }

        return null;
    }



    private getContentElementByUV(uv: THREE.Vector2): Element | null {
        if (!this.svgElement) return null;

        const activeDecalElement = this.svgElement.querySelector('[name*="decal"][active="true"]');
        const activeDecalContainerElement = this.svgElement.querySelector('[name*="decal"][active="true"] [name="container"]');
        const activeDecalContentElement = this.svgElement.querySelector('[name*="decal"][active="true"] [name="content"]');

        if (activeDecalElement instanceof SVGGraphicsElement && activeDecalContainerElement instanceof SVGGraphicsElement) {
            const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
            const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
            const xPos = uv.x * svgWidth;
            const yPos = uv.y * svgHeight;
            const bbox = this.getElementBBox(activeDecalContainerElement, activeDecalElement, false);

            if (!bbox) return null;

            if (xPos >= bbox.x && xPos <= bbox.x + bbox.width && yPos >= bbox.y && yPos <= bbox.y + bbox.height) {
                return activeDecalContentElement;
            }
        }

        return null;
    }


    private selectDecalInIntersection(intersects: THREE.Intersection[]): boolean {
        let decalFound = false;

        if (intersects.length > 0) {
            const intersected = intersects[0];
            const uv = this.getIntersectionUVCoordinates(intersected);

            if (uv) {
                const svgDecalElement = this.getDecalElementByUV(uv);
                const decalContent = svgDecalElement?.querySelector('[name="content"]');

                if (svgDecalElement instanceof SVGGraphicsElement && decalContent instanceof SVGGraphicsElement) {
                    // Calculate the center of the decal in UV coordinates
                    const bbox = this.getElementBBox(decalContent, svgDecalElement, false);
                    if (!bbox) return false;
                    const svgWidth = parseFloat(this.svgElement!.getAttribute('width') || '100');
                    const svgHeight = parseFloat(this.svgElement!.getAttribute('height') || '100');
                    const centerSVGX = (bbox.x + bbox.width * 0.5) / svgWidth;
                    const centerSVGY = (bbox.y + bbox.height * 0.5) / svgHeight;
                    const decalUVCenter = new THREE.Vector2(centerSVGX, centerSVGY);
                    const meshPointByDecalCenter = this.getMeshPointByUV(intersected.object, decalUVCenter);
                    const screenPointForDecalCenter = this.reverseRaycast(meshPointByDecalCenter);
                    const deltaX = screenPointForDecalCenter.x - this.startScalePos.x;
                    const deltaY = screenPointForDecalCenter.y - this.startScalePos.y;
                    const angleRadians = Math.atan2(uv.y - centerSVGY, uv.x - centerSVGX);

                    // Save the initial values
                    this.startDragCoordinates = new THREE.Vector2(
                        uv.x - ((bbox.x) / svgWidth),
                        uv.y - ((bbox.y) / svgHeight)
                    );
                    this.startScaleCenter = screenPointForDecalCenter;
                    this.savedRotateAngle = parseFloat(svgDecalElement.getAttribute('rotate') || '0');
                    this.savedScale = parseFloat(svgDecalElement.getAttribute('scale') || '1');
                    this.distanceFromCenterOnStart = Math.sqrt(deltaX ** 2 + deltaY ** 2);
                    this.startRotateAngle = angleRadians * (180 / Math.PI);


                    // Highlight the selected decal
                    this.activateDecal(svgDecalElement);

                    decalFound = true;
                } else {
                    this.deactivateAllDecals();
                }

                this.emit('click', [{ uv, svgDecalElement }]);
            }
        } else {
            this.deactivateAllDecals();
        }

        return decalFound
    }

    private useControlByClickedPosition(intersects: THREE.Intersection[]): Element | null {
        if (intersects.length > 0 && intersects[0].uv) {
            return this.getControlElementByUV(intersects[0].uv);
        } else {
            return null;
        }
        
    }

    private useContentByClickedPosition(intersects: THREE.Intersection[]): Element | null {
        if (intersects.length > 0 && intersects[0].uv) {
            return this.getContentElementByUV(intersects[0].uv);
        } else {
            return null;
        }
        
    }

    private selectDecalByClickedPosition(intersects: THREE.Intersection[]): boolean {
        return this.selectDecalInIntersection(intersects);
    }

    private handleDragDecal(event: MouseEvent): string | null {
        const activeDecal = this.svgElement?.querySelector('g[name*="decal"][active="true"]') as SVGGraphicsElement | null;

        console.timeLog('dragging', 'activeDecal');
        if (!this.svgElement || !activeDecal) return null;
        
        const intersects = this.getMouseIntersections(event);
        console.timeLog('dragging', 'getMouseIntersections');

        if (intersects.length > 0) {
            const intersected = intersects[0];
            const uv = this.getIntersectionUVCoordinates(intersected);
            console.timeLog('dragging', 'get uv');

            if (uv) {
                const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
                const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');

                if (this.startDragCoordinates) {
                    uv.x -= this.startDragCoordinates.x;
                    uv.y -= this.startDragCoordinates.y;
                }

                this.updateDecal(activeDecal.getAttribute('name') || '', {
                    x: uv.x * svgWidth,
                    y: uv.y * svgHeight,
                });

                console.timeLog('dragging', 'update svg');
            }
        }

        const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);
        console.timeLog('dragging', 'serializeToString svg');

        return updatedSVGContent;
    }

    private handleRotateDecal(event: MouseEvent): string | null {
        const activeDecal = this.svgElement?.querySelector('g[name*="decal"][active="true"]') as SVGGraphicsElement | null;
        const contentElement = activeDecal?.querySelector('[name="content"]');
        
        if (!this.svgElement || !activeDecal || !(contentElement instanceof SVGGraphicsElement)) return null;
        
        const contentBBox = this.getElementBBox(contentElement, activeDecal, false);
        const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
        const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
        const intersects = this.getMouseIntersections(event);

        if (contentBBox && intersects.length > 0) {
            const intersected = intersects[0];
            const uv = this.getIntersectionUVCoordinates(intersected);
            
            if (!uv) return null;
    
            const centerX = (contentBBox.x + (contentBBox.width * 0.5)) / svgWidth;
            const centerY = (contentBBox.y + (contentBBox.height * 0.5)) / svgHeight;
            const angleRadians = Math.atan2(uv.y - centerY, uv.x - centerX);
            let deg = ((angleRadians * (180 / Math.PI) + 360)) % 360;
    
            deg -= this.startRotateAngle; // offset
            deg += this.savedRotateAngle; // previous value
    
            this.updateDecal(activeDecal.getAttribute('name') || '', {
                rotate: deg % 360
            });
        }

        const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);

        return updatedSVGContent;
    }

    private handleScaleDecal(event: MouseEvent): string | null {
        const activeDecal = this.svgElement?.querySelector('g[name*="decal"][active="true"]') as SVGGraphicsElement | null;
        const contentElement = activeDecal?.querySelector('[name="content"]');
        
        if (!this.svgElement || !activeDecal || !(contentElement instanceof SVGGraphicsElement)) return null;
        
        const deltaX = event.clientX - this.startScaleCenter.x;
        const deltaY = event.clientY - this.startScaleCenter.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const scale = this.savedScale * distance / this.distanceFromCenterOnStart;

        this.updateDecal(activeDecal.getAttribute('name') || '', {
            scale: scale
        });

        const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);

        return updatedSVGContent;
    }

    private activateDecal(decal: SVGGraphicsElement): void {
        const containerElement = decal.querySelector('[name="container"]');
        
        decal.setAttribute('active', 'true');
        containerElement?.setAttribute('class', 'dashed-border');

        this.svgElement?.querySelectorAll(`[name*="decal"]`).forEach((el) => {
            if (el !== decal) {
                const inactiveContainerElement = el.querySelector('[name="container"]');

                el.setAttribute('active', 'false');
                inactiveContainerElement?.removeAttribute('class');
            }
        });
    }

    private deactivateAllDecals(): void {
        this.svgElement?.querySelectorAll(`[name*="decal"]`).forEach((el) => {
            const inactiveContainerElement = el.querySelector('[name="container"]');

            el.setAttribute('active', 'false');
            inactiveContainerElement?.removeAttribute('class');
        });
    }

    private generateRandomRay (): THREE.Intersection[] | undefined {
        if (!this.modelGroup) {
            console.warn('Main model is not set.');
            return;
        }

        const boundingBox = new THREE.Box3().setFromObject(this.modelGroup);
        const boundingCenter = new THREE.Vector3();
        const boundingSize = new THREE.Vector3();
    
        boundingBox.getSize(boundingSize);
        boundingBox.getCenter(boundingCenter);
    
        const modelSize = boundingSize.length();
        const distance = modelSize;
        const randomPoint = new THREE.Vector3(
            THREE.MathUtils.lerp(
                boundingBox.min.x - distance,
                boundingBox.max.x + distance,
                Math.random(),
            ),
            THREE.MathUtils.lerp(
                boundingBox.min.y - distance,
                boundingBox.max.y + distance,
                Math.random(),
            ),
            this.camera.position.z,
        );

        const rayDirection = new THREE.Vector3();

        rayDirection.subVectors(boundingCenter, randomPoint).normalize();

        this.raycaster.far = boundingCenter.distanceTo(randomPoint);
        this.raycaster.set(randomPoint, rayDirection);
        this.raycaster.firstHitOnly = true;

        const intersects = this.raycaster
            .intersectObjects(this.scene.children, true)
            .filter((inters) => inters.object.type === "Mesh");

        const appropriateIntersections = intersects.filter((mesh) => {
            let currentObject: THREE.Object3D<THREE.Object3DEventMap> | null =
                mesh.object;

            while (currentObject) {
                if (currentObject === this.modelGroup || currentObject.name === this.modelGroup?.name) {
                    return true;
                }
                currentObject = currentObject.parent; // Traverse up the hierarchy
            }

            return false;
        });

        if (appropriateIntersections.length > 0) {
            return appropriateIntersections;
        } else if (this.maxAttemps > 0) {
            this.maxAttemps--;
            return this.generateRandomRay();
        }
    };

    private createControlButtonsGroup(): SVGGraphicsElement {
        const controlsGroup = document.createElementNS(svgNS, 'g');
        const rotateIcon = document.createElementNS(svgNS, 'path');
        const scaleIcon = document.createElementNS(svgNS, 'g');

        rotateIcon.setAttribute('fill', 'none');
        rotateIcon.setAttribute('stroke', 'currentColor');
        rotateIcon.setAttribute('stroke-linecap', 'round');
        rotateIcon.setAttribute('stroke-linejoin', 'round');
        rotateIcon.setAttribute('stroke-width', '2');
        rotateIcon.setAttribute('d', 'M19.95 11a8 8 0 1 0-.5 4m.5 5v-5h-5');
        rotateIcon.setAttribute('name', 'control-rotate-icon');
        rotateIcon.setAttribute('transform', 'translate(0, 0)');

        scaleIcon.setAttribute('fill', 'none');
        scaleIcon.setAttribute('name', 'control-scale-icon');
        scaleIcon.innerHTML = `<path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z"></path><path fill="currentColor" d="M11 3a1 1 0 0 1 .117 1.993L11 5H5v14h14v-6a1 1 0 0 1 1.993-.117L21 13v6a2 2 0 0 1-1.85 1.995L19 21H5a2 2 0 0 1-1.995-1.85L3 19V5a2 2 0 0 1 1.85-1.995L5 3zm8.75 0c.69 0 1.25.56 1.25 1.25V8a1 1 0 1 1-2 0V6.414L12.414 13H14a1 1 0 1 1 0 2h-3.75C9.56 15 9 14.44 9 13.75V10a1 1 0 0 1 2 0v1.586L17.586 5H16a1 1 0 1 1 0-2z"></path>`;

        controlsGroup.appendChild(rotateIcon);
        controlsGroup.appendChild(scaleIcon);
        controlsGroup.setAttribute('name', 'controls');

        return controlsGroup;
    }

    private createDecalMainGroup(decalName: string): SVGGraphicsElement | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }
        
        const group = document.createElementNS(svgNS, 'g');
        const container = document.createElementNS(svgNS, 'g');
        const contentGroup = document.createElementNS(svgNS, 'g');
        const controlsGroup = this.createControlButtonsGroup();
        
        contentGroup.setAttribute('name', 'content');
        container.setAttribute('name', 'container');
        container.appendChild(contentGroup);
        group.appendChild(container);
        group.appendChild(controlsGroup);

        group.setAttribute('name', `${decalName}`);

        return group;
    }


    private createTextDecal(uv: THREE.Vector2, decalName: string, text: string, size: number): SVGGraphicsElement | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }

        const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
        const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
        const textElement = document.createElementNS(svgNS, 'text');
        const decalGroup = this.createDecalMainGroup(decalName);
        const contentGroup = decalGroup?.querySelector('[name="content"]');

        // Position
        const x = uv.x * svgWidth;
        const y = uv.y * svgHeight;

        if (decalGroup && contentGroup) {
            // Text styling and position
            textElement.setAttribute('x', x.toString());
            textElement.setAttribute('y', y.toString());
            textElement.setAttribute('font-size', size.toString());
            textElement.setAttribute('text-anchor', 'start');
            textElement.setAttribute('dominant-baseline', 'text-before-edge');
            textElement.setAttribute('fill', 'black');
            textElement.setAttribute('font-family', 'sans-serif');
            textElement.setAttribute('name', 'text');
            textElement.textContent = text;

            // Append both to the group
            contentGroup.appendChild(textElement);
            decalGroup.setAttribute('posX', x.toString());
            decalGroup.setAttribute('posY', y.toString());
        }

        return decalGroup;
    }

    private updateControlsPosition(decal: SVGGraphicsElement): void {
        const containerGroup = decal.querySelector('[name="container"]');
        const controlGroup = decal.querySelector('[name="controls"]');
        const rotateIcon = controlGroup?.querySelector('[name="control-rotate-icon"]');

        if (containerGroup instanceof SVGGraphicsElement) {
            const containerBBox = this.getElementBBox(containerGroup, decal, false);

            if (!containerBBox) return;

            if (controlGroup instanceof SVGGraphicsElement) {
                controlGroup.setAttribute('transform', `translate(${containerBBox.x - 30}, ${containerBBox.y + containerBBox.height - 20})`);
            }
            if (rotateIcon instanceof SVGGraphicsElement) {
                rotateIcon.setAttribute('transform', `translate(${containerBBox.width + 32}, ${-containerBBox.height + 16})`);
            }
        }
    }

    public updateDecal(decalName: string, properties: {
        x?: number;
        y?: number;
        fill?: string;
        rotate?: number;
        scale?: number;
    }): string | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }

        const decal = this.svgElement.querySelector(`[name="${decalName}"]`);
        const contentElement = decal?.querySelector('[name="content"]');

        if (decal instanceof SVGGraphicsElement && contentElement instanceof SVGGraphicsElement) {
            Array.from(contentElement.children).forEach((child) => {
                if (child instanceof SVGGraphicsElement) {
                    if (properties.x) {
                        child.setAttribute('x', properties.x?.toString());
                        decal.setAttribute('posX', properties.x.toString());
                    }
                    if (properties.y) {
                        child.setAttribute('y', properties.y?.toString());
                        decal.setAttribute('posY', properties.y.toString());                        
                    }
                    
                    if (properties.fill) {
                        child.setAttribute('fill', properties.fill);
                        decal.setAttribute('fill', properties.fill.toString());
                    }
                }
            });
            const rotate = properties.rotate || decal.getAttribute('rotate') || 0;
            const scale = properties.scale || parseFloat(decal.getAttribute('scale') || '1');

            contentElement.setAttribute('style', `
                    transform-origin: center;
                    transform: scale(${scale}) rotate(${rotate}deg);
                    transform-box: fill-box;
                `);

            decal.setAttribute('rotate', rotate.toString());
            decal.setAttribute('scale', scale.toString());

            this.updateControlsPosition(decal);
        }

        const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);
        return updatedSVGContent;
    }

    public putDecal(position?: THREE.Vector2, params?: {
        text?: string;
        size?: number;
        fill?: string;
        rotate?: number;
        scale?: number;
    }): string | null {
        const decalId = Math.random().toString(36).substring(2, 15);
        const decalName = `decal-${decalId}`;
        let uv = position;

        if (!uv) {
            const intersects = this.generateRandomRay();

            if (intersects && intersects.length > 0) {
                const intersection = intersects[0];
                uv = intersection.uv;
            } else {
                console.warn('No intersection found.');
                return null;
            }
        }
        if (!uv) {
            console.warn('No UV coordinates found.');
            return null;
        }

        if (!this.svgElement) {
            console.warn('SVG content is empty.');
            return null;
        }

        // const decal = this.createCircleDecal(uv, decalName);
        const decal = this.createTextDecal(uv, decalName, params?.text || 'TEST', params?.size || 40);

        if (!decal) {
            console.warn('Failed to create decal.');
            return null;
        }

        this.svgElement.appendChild(decal);
        this.updateControlsPosition(decal);
        this.decalSVGTexture?.updateSVGTexture();

        const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);
        return updatedSVGContent;
    }

    public downloadDecalTexture(filename: string = 'decal.svg'): void {
        this.deactivateAllDecals();
        this.decalSVGTexture?.downloadSVG(filename);
    }

    public getSVGElement(): SVGSVGElement | null {
        return this.svgElement;
    }
}