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
    private controls: OrbitControls;
    private svgElement: SVGSVGElement | null = null;
    private maxAttemps = 10;
    private dragging = false;
    private rotating = false;
    private updating = false;
    private startDragCoordinates: THREE.Vector2 | null = null;
    private savedRotateAngle: number = 0;
    private startRotateAngle: number = 0;
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

    constructor(scene: THREE.Scene, model: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
        super();
        this.scene = scene;
        this.mainModel = model;
        this.camera = camera;
        this.controls = controls;
        this.raycaster.firstHitOnly = true;

        this.scene.add(this.modelGroup);
        this.modelGroup.name = 'MergeMaterialsGroup';
        this.decalMaterial = new THREE.MeshStandardMaterial({
            name: 'decalMaterial',
            transparent: true,
            opacity: 1,
            visible: true
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


        console.log('this.scene', this.scene);
        console.timeEnd('computeBoundsTree');

        this.svgElement = this.decalSVGTexture?.getSVGElement() || null;
        this.initEventListeners();
    }

    private initEventListeners() {
        window.addEventListener('mousedown', (event: MouseEvent) => {
            if (!this.svgElement) return;

            const intersects = this.getMouseIntersections(event);
            const decalIntersected = this.selectDecalByClickedPosition(intersects);
            const controlIntersected = this.useControlByClickedPosition(intersects);
            const contentIntersected = this.useContentByClickedPosition(intersects);
            const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);

            console.log('controlIntersected', controlIntersected);
            console.log('contentIntersected', contentIntersected);

            this.dragging = decalIntersected && contentIntersected !== null;
            this.rotating = decalIntersected && controlIntersected !== null && controlIntersected.getAttribute('name') === 'control-rotate-icon';
            this.controls.enablePan = !this.dragging && !this.rotating;
            this.controls.enableZoom = !this.dragging && !this.rotating;
            this.controls.enableRotate = !this.dragging && !this.rotating;

            this.decalSVGTexture?.updateSVGTexture();

            this.emit('update', [{ event, updatedSVGContent, dragging: this.dragging }]);
        });

        window.addEventListener('mousemove', (event: MouseEvent) => {
            if (this.updating) return;

            this.controls.enablePan = !this.dragging && !this.rotating;
            this.controls.enableZoom = !this.dragging && !this.rotating;
            this.controls.enableRotate = !this.dragging && !this.rotating;

            if (this.dragging || this.rotating) {
                this.updating = true;

                console.time('dragging');

                let updatedSVGContent: string | null = null;

                if (this.dragging) {
                    updatedSVGContent = this.handleDragDecal(event);
                } else if (this.rotating) {
                    updatedSVGContent = this.handleRotateDecal(event);
                }
                

                console.timeLog('dragging', 'updatedSVGContent');

                if (updatedSVGContent) {
                    this.decalSVGTexture?.updateSVGTexture(() => {
                        console.timeEnd('dragging');

                        requestAnimationFrame(() => {
                            this.updating = false;
                        });
                    });
                    this.emit('update', [{ event, updatedSVGContent, dragging: this.dragging }]);

                    console.timeLog('dragging', 'this.emit update');
                }
            }
        });
        window.addEventListener('mouseup', (event) => {
            this.dragging = false;
            this.rotating = false;
            this.controls.enablePan = !this.dragging && !this.rotating;
            this.controls.enableZoom = !this.dragging && !this.rotating;
            this.controls.enableRotate = !this.dragging && !this.rotating;

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


    private getIntersectionUVCoordinates(intersected: THREE.Intersection | undefined): THREE.Vector2 | null {
        if (intersected?.uv) {
            return intersected.uv.clone();
        }
        return null;
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
                let translateX = 0, translateY = 0;

                if (transform) {
                    const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
                    if (match) {
                        translateX = parseFloat(match[1]) || 0;
                        translateY = parseFloat(match[2]) || 0;
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

        const activeDecalContentElement = this.svgElement.querySelector('[name*="decal"][active="true"] [name="content"]');

        if (activeDecalContentElement instanceof SVGGraphicsElement) {
            const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
            const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
            const xPos = uv.x * svgWidth;
            const yPos = uv.y * svgHeight;
            const bbox = activeDecalContentElement.getBBox();

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
                    const bbox = decalContent?.getBBox();

                    this.startDragCoordinates = new THREE.Vector2(
                        uv.x - ((bbox.x) / parseFloat(this.svgElement!.getAttribute('width') || '100')),
                        uv.y - ((bbox.y) / parseFloat(this.svgElement!.getAttribute('height') || '100'))
                    );
                    this.savedRotateAngle = parseFloat(svgDecalElement.getAttribute('rotate') || '0');

                    const svgWidth = parseFloat(this.svgElement!.getAttribute('width') || '100');
                    const svgHeight = parseFloat(this.svgElement!.getAttribute('height') || '100');

                    
                    const centerX = (bbox.x + (bbox.width * 0.5)) / svgWidth;
                    const centerY = (bbox.y + (bbox.height * 0.5)) / svgHeight;
                    const angleRadians = Math.atan2(uv.y - centerY, uv.x - centerX);

                    this.startRotateAngle = angleRadians * (180 / Math.PI);






                    console.log('this.startDragCoordinates', this.startDragCoordinates);
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
        
        const contentBBox = contentElement?.getBBox();
        const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
        const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
        const intersects = this.getMouseIntersections(event);
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
            rotate: deg
        });

        const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);

        return updatedSVGContent;
    }

    private activateDecal(decal: SVGGraphicsElement): void {
        const contentElement = decal.querySelector('[name="content"]');
        
        decal.setAttribute('active', 'true');
        contentElement?.setAttribute('class', 'dashed-border');

        this.svgElement?.querySelectorAll(`[name*="decal"]`).forEach((el) => {
            if (el !== decal) {
                const inactiveContentElement = el.querySelector('[name="content"]');

                el.setAttribute('active', 'false');
                inactiveContentElement?.removeAttribute('class');
            }
        });
    }

    private deactivateAllDecals(): void {
        this.svgElement?.querySelectorAll(`[name*="decal"]`).forEach((el) => {
            const inactiveContentElement = el.querySelector('[name="content"]');

            el.setAttribute('active', 'false');
            inactiveContentElement?.removeAttribute('class');
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
            THREE.MathUtils.lerp(
                boundingBox.min.z - distance,
                boundingBox.max.z + distance,
                Math.random(),
            )
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

    private createDecalContainer(decalName: string): SVGGraphicsElement | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }
        
        const group = document.createElementNS(svgNS, 'g');
        const contentGroup = document.createElementNS(svgNS, 'g');
        const controlsGroup = document.createElementNS(svgNS, 'g');
        const rotateIcon = document.createElementNS(svgNS, 'path');

        rotateIcon.setAttribute('fill', 'none');
        rotateIcon.setAttribute('stroke', 'currentColor');
        rotateIcon.setAttribute('stroke-linecap', 'round');
        rotateIcon.setAttribute('stroke-linejoin', 'round');
        rotateIcon.setAttribute('stroke-width', '2');
        rotateIcon.setAttribute('d', 'M19.95 11a8 8 0 1 0-.5 4m.5 5v-5h-5');
        rotateIcon.setAttribute('name', 'control-rotate-icon');
        controlsGroup.setAttribute('name', 'controls');
        contentGroup.setAttribute('name', 'content');
        
        controlsGroup.appendChild(rotateIcon);
        group.appendChild(contentGroup);
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
        const container = this.createDecalContainer(decalName);
        const contentGroup = container?.querySelector('[name="content"]');

        // Position
        const x = uv.x * svgWidth;
        const y = uv.y * svgHeight;

        if (container && contentGroup) {
            // Text styling and position
            textElement.setAttribute('x', x.toString()); // Add some padding inside rect
            textElement.setAttribute('y', y.toString()); // Rough vertical centering
            textElement.setAttribute('font-size', size.toString());
            textElement.setAttribute('text-anchor', 'start');
            textElement.setAttribute('dominant-baseline', 'text-before-edge');
            textElement.setAttribute('fill', 'black');
            textElement.setAttribute('font-family', 'sans-serif');
            textElement.setAttribute('name', 'text');
            textElement.textContent = text;

            // Append both to the group
            contentGroup.appendChild(textElement);
        }

        return container;
    }

    private updateControlsPosition(decal: SVGGraphicsElement): void {
        const contentGroup = decal.querySelector('[name="content"]');
        const controlGroup = decal.querySelector('[name="controls"]');

        if (contentGroup instanceof SVGGraphicsElement) {
            const contentBBox = contentGroup?.getBBox();

            if (controlGroup instanceof SVGGraphicsElement) {
                controlGroup.setAttribute('transform', `translate(${contentBBox.x + contentBBox.width}, ${contentBBox.y - 20})`);
            }
        }
    }

    public updateDecal(decalName: string, properties: {
        x?: number;
        y?: number;
        fill?: string;
        rotate?: number;
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

            const bbox = contentElement.getBBox();
            const rotate = properties.rotate || decal.getAttribute('rotate') || 0;

            contentElement.setAttribute('transform', `rotate(${rotate}, ${bbox.x + (bbox.width * 0.5)}, ${bbox.y + (bbox.height * 0.5)})`);
            decal.setAttribute('rotate', (rotate).toString());

            this.updateControlsPosition(decal);
        }

        const updatedSVGContent = new XMLSerializer().serializeToString(this.svgElement);
        return updatedSVGContent;
    }

    public putDecal(position?: THREE.Vector2): string | null {
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
        const decal = this.createTextDecal(uv, decalName, 'TEST', 40);

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