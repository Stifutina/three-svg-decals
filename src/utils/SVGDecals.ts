import * as THREE from 'three';
import {
	computeBoundsTree, disposeBoundsTree, acceleratedRaycast,
} from 'three-mesh-bvh';

// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

import EventEmitter from './EventEmitter';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { SVGTexture } from './SVGTexture';


export class SVGDecals extends EventEmitter {
    private readonly SVG_NS = 'http://www.w3.org/2000/svg';
    private readonly DECAL_MESH_PREFIX = 'decalMesh';
    private readonly ATTR_NAME = 'name';
    private readonly ATTR_ACTIVE = 'active';
    private readonly ATTR_CONTROLS = 'controls';
    private readonly ATTR_CONTENT = 'content';
    private readonly ATTR_CONTAINER = 'container';
    private readonly ATTR_ICON = 'icon';
    private readonly ATTR_IMAGE = 'image';
    private readonly ATTR_TEXT = 'text';
    private readonly ATTR_COLORVAL = 'colorVal';
    private readonly ATTR_POSX = 'posX';
    private readonly ATTR_POSY = 'posY';
    private readonly ATTR_ROTATE = 'rotate';
    private readonly ATTR_SCALE = 'scale';
    private readonly ATTR_CONTROL_ROTATE = 'control-rotate-icon';
    private readonly ATTR_CONTROL_SCALE = 'control-scale-icon';
    private readonly ATTR_CONTROL_DELETE = 'control-delete-icon';

    private scene: THREE.Scene;
    private mainModel: THREE.Object3D | null = null;
    private raycaster = new THREE.Raycaster();
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private svgElement: SVGSVGElement | null = null;
    private maxAttemps = 10;
    private interactionEnabled = false;
    private dragging = false;
    private rotating = false;
    private scaling = false;
    private deleting = false;
    private updating = false;
    private startDragCoordinates: THREE.Vector2 | null = null;
    private savedRotateAngle: number = 0;
    private startRotateAngle: number = 0;
    private savedScale: number = 0;
    private distanceFromCenterOnStart: number = 0;
    private startScalePos: {x: number, y: number} = {x: 0, y: 0};
    private startScaleCenter: {x: number, y: number} = {x: 0, y: 0};
    private decalSVGInitial = `
            <svg xmlns="${this.SVG_NS}" width="2048" height="2048" fill="none" viewBox="0 0 2048 2048" version="1.1" xml:space="preserve">
                <style>
                    .dashed-border {
                        outline: 1px dashed black;
                    }
                    [${this.ATTR_NAME}="${this.ATTR_CONTROLS}"] {
                        display: none;
                    }
                    [${this.ATTR_ACTIVE}="true"] [${this.ATTR_NAME}="${this.ATTR_CONTROLS}"] {
                        display: block;
                    }
                </style>
            </svg>
        `;
    private decalMaterial: THREE.MeshStandardMaterial;
    private decalSVGTexture: SVGTexture | null = null;
    private XMLSerializer = new XMLSerializer();

    /**
     * Create an instance of SVGDecals.
     * @param scene - The THREE.Scene instance.
     * @param model - The main model object.
     * @param camera - The THREE.PerspectiveCamera instance.
     * @param controls - The OrbitControls instance.
     * @param renderer - The THREE.WebGLRenderer instance.
     */
    constructor(scene: THREE.Scene, model: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls, renderer: THREE.WebGLRenderer) {
        super();
        this.scene = scene;
        this.mainModel = model;
        this.camera = camera;
        this.renderer = renderer;
        this.controls = controls;
        this.raycaster.firstHitOnly = true;

        /** Material for the decal meshes. */
        this.decalMaterial = new THREE.MeshStandardMaterial({
            name: 'decalMaterial',
            transparent: true,
            opacity: 1,
            visible: true,
        });
        /** SVGTexture instance for the decal. */
        this.decalSVGTexture = new SVGTexture(this.decalSVGInitial, this.decalMaterial);

        console.time('computeBoundsTree');

        /** Traverse the main model and create decal meshes for each child mesh. */
        this.mainModel.traverse((child) => {
            if (child instanceof THREE.Mesh && child.parent) {
                const decalMesh = child.clone();

                decalMesh.material = this.decalMaterial;
                decalMesh.material.map.flipY = false;
                decalMesh.material.visible = false;
                decalMesh.name = `${child.name}-${this.DECAL_MESH_PREFIX}`;
                
                child.parent.add(decalMesh);

                child.geometry.computeBoundsTree();
                decalMesh.geometry.computeBoundsTree();
            }
        });

        console.timeEnd('computeBoundsTree');

        this.svgElement = this.decalSVGTexture?.getSVGElement() || null;
        this.initEventListeners();
    }

    /**
     * Enables decal interactions.
     */
    public enableDecalInteractions() {
        this.interactionEnabled = true;
    }

    /**
     * Disables decal interactions and deactivates all decals.
     */
    public disableDecalInteractions() {
        this.deactivateAllDecals();
        this.interactionEnabled = false;
    }

    /**
     * Deletes the currently active decal.
     */
    public deleteDecal(id?: string): void {
        const decal = this.svgElement?.querySelector(`[${this.ATTR_NAME}="${id}"]`);

        if (decal) {
            decal.remove();
        } else {
            const activeDecal = this.svgElement?.querySelector(`g[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`);

            activeDecal?.remove();
        }

        this.decalSVGTexture?.updateSVGTexture();
    }

    /**
     * Selects a decal by its ID and updates the controls position.
     * @param id decal name
     */
    public selectDecal(id: string): void {
        const decal = this.svgElement?.querySelector(`[${this.ATTR_NAME}="${id}"]`) as SVGGraphicsElement | null;

        if (decal && this.svgElement) {
            this.activateDecal(decal);
            this.updateControlsPosition(decal);
            this.decalSVGTexture?.updateSVGTexture();

            const actualProps = this.getDecalProperties(decal);
            const updatedSVGContent = this.XMLSerializer.serializeToString(this.svgElement);

            this.emit('update', [{ 
                event, 
                updatedSVGContent, 
                dragging: this.dragging,
                rotating: this.rotating,
                scaling: this.scaling,
                props: actualProps
            }]);
        }
    }

    /**
     * Updates a decal's properties.
     * @param decalName - The name of the decal to update.
     * @param properties - The properties to update.
     * @returns The updated SVG content string or null.
     */
    public updateDecal(decalName: string, properties: {
        x?: number;
        y?: number;
        fill?: string;
        rotate?: number;
        scale?: number;
        text?: string;
    }): string | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }

        const decal = this.svgElement.querySelector(`[${this.ATTR_NAME}="${decalName}"]`);
        const contentElement = decal?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);

        if (decal instanceof SVGGraphicsElement && contentElement instanceof SVGGraphicsElement) {
            Array.from(contentElement.children).forEach((child) => {
                if (child instanceof SVGGraphicsElement) {
                    /** Set X Position */
                    if (properties.x) {
                        child.setAttribute('x', properties.x?.toString());
                        decal.setAttribute(this.ATTR_POSX, properties.x.toString());
                    }
                    /** Set Y Position */
                    if (properties.y) {
                        child.setAttribute('y', properties.y?.toString());
                        decal.setAttribute(this.ATTR_POSY, properties.y.toString());                        
                    }
                    /** Set decal Color */
                    if (properties.fill) {
                        if (child.tagName === 'text') {
                            child.setAttribute('fill', properties.fill);
                        } else if (child.tagName === 'g' && child.getAttribute(this.ATTR_NAME) === this.ATTR_ICON) {
                            Array.from(child.children).forEach((iconChild) => {
                                if (properties.fill && iconChild instanceof SVGElement) {
                                    const fillAttr = iconChild.getAttribute('fill');
                                    const strokeAttr = iconChild.getAttribute('stroke');

                                    if (fillAttr && fillAttr !== 'none') {
                                        iconChild.setAttribute('fill', properties.fill);
                                    } else if (strokeAttr && strokeAttr !== 'none') {
                                        iconChild.setAttribute('stroke', properties.fill);
                                        iconChild.setAttribute('fill', 'none');
                                    }
                                }
                            });
                        }
                        
                        decal.setAttribute(this.ATTR_COLORVAL, properties.fill.toString());
                    }
                    /** Update Text */
                    if (child.tagName === 'text' && properties.text) {
                        child.textContent = properties.text;
                    }
                    /** Set XY Position for icon decal */
                    if (child.tagName === 'g' && child.getAttribute(this.ATTR_NAME) === this.ATTR_ICON) {
                        const x = properties.x || parseFloat(decal.getAttribute(this.ATTR_POSX) || '0');
                        const y = properties.y || parseFloat(decal.getAttribute(this.ATTR_POSY) || '0');

                        child.setAttribute('transform', `translate(${x}, ${y})`);
                    }
                }
            });

            /** Update Scaling and Rotate */

            const rotate = (properties.rotate !== undefined) ? properties.rotate : decal.getAttribute(this.ATTR_ROTATE) || 0;
            const scale = properties.scale || parseFloat(decal.getAttribute(this.ATTR_SCALE) || '1');

            contentElement.setAttribute('style', `
                    transform-origin: center;
                    transform: scale(${scale}) rotate(${rotate}deg);
                    transform-box: fill-box;
                `);

            decal.setAttribute(this.ATTR_ROTATE, rotate.toString());
            decal.setAttribute(this.ATTR_SCALE, scale.toString());

            this.updateControlsPosition(decal);
        }

        if (!this.updating) {
            // const x = properties.x || parseFloat(decal?.getAttribute(this.ATTR_POSX) || '0');
            // const y = properties.y || parseFloat(decal?.getAttribute(this.ATTR_POSY) || '0');
            // const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
            // const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
            
            this.decalSVGTexture?.updateSVGTexture();

            // const activeMesh = this.getMeshByUVCoords(new THREE.Vector2(
            //     x/svgWidth,
            //     y/svgHeight
            // ));

            // console.log('activeMesh', activeMesh);

            // this.mainModel?.traverse((child) => {
            //     if (child instanceof THREE.Mesh && child.name.includes(this.DECAL_MESH_PREFIX)) {
            //         child.material.visible = true;
            //     } 
            //     // else if (child instanceof THREE.Mesh) {
            //     //     child.material.visible = false;
            //     // }
            // });
        }
        

        const updatedSVGContent = this.XMLSerializer.serializeToString(this.svgElement);
        return updatedSVGContent;
    }

    /**
     * Adds a new decal with specified parameters.
     * @param position - The UV position where the decal will be placed.
     * @param params - The decal parameters.
     * @returns New decal name or null if failed.
     */
    public putDecal(position?: THREE.Vector2, params?: {
        text?: string;
        id?: string;
        image?: Base64URLString;
        icon?: SVGElement;
        size?: number;
        fill?: string;
        rotate?: number;
        scale?: number;
    }): string | null {
        const decalId = Math.random().toString(36).substring(2, 15);
        const decalName = params?.id || `decal-${decalId}`;
        let uv = position;

        if (!this.svgElement) {
            console.warn('SVG Texture not initialized!');
            return null;
        }

        if (!uv) {
            const intersects = this.generateRandomRay();

            if (intersects && intersects.length > 0) {
                const intersection = intersects[0];
                uv = intersection.uv;
            } else {
                console.warn('No intersection found.');
                return null;
            }
        } else {
            const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
            const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');

            uv.x /= svgWidth;
            uv.y /= svgHeight;
        }
        if (!uv) {
            console.warn('No UV coordinates found.');
            return null;
        }

        if (!this.svgElement) {
            console.warn('SVG content is empty.');
            return null;
        }

        let decal;

        if (params?.text) {
            decal = this.createTextDecal(uv, decalName, params?.text, params?.size || 40);
        } else if (params?.image) {
            decal = this.createImageDecal(uv, decalName, params?.image, params?.size || 100);
        } else if (params?.icon) {
            decal = this.createIconDecal(uv, decalName, params?.icon);
        } else {
            decal = this.createTextDecal(uv, decalName, 'TEST', params?.size || 40);
        }

        if (!decal) {
            console.warn('Failed to create decal.');
            return null;
        }

        this.svgElement.appendChild(decal);
        this.updateControlsPosition(decal);
        this.updateDecal(decalName, {
            rotate: params?.rotate || 0,
            scale: params?.scale || 1,
            fill: params?.fill || 'black'
        });

        return decalName;
    }

    /**
     * Returns the SVG element used for decals.
     * @returns The SVGSVGElement or null if not available.
     */
    public getSVGElement(): SVGSVGElement | null {
        return this.svgElement;
    }

    /**
     * Extracts decal properties from a given SVG graphics element.
     *
     * This method retrieves specific attribute values from the provided decal element,
     * including properties for text, color, scale, rotation, and position. It also attempts
     * to fetch the decal's identifier. Default values are used if certain attributes are missing:
     * - 'black' for color,
     * - 1 for scale,
     * - 0 for rotation,
     * - 0 for both x and y position.
     *
     * @param decal - The SVG graphics element representing the decal.
     * @returns An object containing:
     *   - id: The decal's identifier.
     *   - text: The text content extracted from the decal.
     *   - color: The color value of the decal.
     *   - scale: The scale factor of the decal.
     *   - rotate: The rotation angle of the decal.
     *   - x: The x-coordinate position of the decal.
     *   - y: The y-coordinate position of the decal.
     */
    public getDecalProperties(decal?: SVGGraphicsElement): { id: string, text: string, color: string, scale: number, rotate: number, x: number, y: number } | null {
        if (!decal) {
            decal = this.svgElement?.querySelector(`g[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`) as SVGGraphicsElement;
        }

        if (!decal) {
            console.warn('No active decal found.');
            return null;
        }
        
        const textElement = decal.querySelector(`[${this.ATTR_NAME}="${this.ATTR_TEXT}"]`) as SVGGraphicsElement;
        const text = textElement?.textContent || '';
        const color = decal.getAttribute(this.ATTR_COLORVAL) || 'black';
        const scale = parseFloat(decal.getAttribute(this.ATTR_SCALE) || '1');
        const rotate = parseFloat(decal.getAttribute(this.ATTR_ROTATE) || '0');
        const x = parseFloat(decal.getAttribute(this.ATTR_POSX) || '0');
        const y = parseFloat(decal.getAttribute(this.ATTR_POSY) || '0');
        const id = decal.getAttribute(this.ATTR_NAME) || '';

        return { text, color, scale, rotate, x, y, id };
    }



    // ──────────────────────────────────────────────────────────────
    // Private Methods
    // ──────────────────────────────────────────────────────────────

    /**
     * Initializes event listeners for mouse interactions.
     *
     * This method attaches event listeners for 'mousedown', 'mousemove', and 'mouseup' events to the window.
     * - On mousedown, it checks if interaction is enabled, validates the event target, and determines intersections with decals, control handles, and content.
     *   Based on which element is interacted with, it sets flags for dragging, rotating, scaling, or deleting, and disables camera controls accordingly.
     *   It also serializes the updated SVG content and emits an 'update' event with the initial properties.
     *
     * - On mousemove, if dragging, rotating, or scaling is active, it updates the SVG decal accordingly by calling the appropriate handler.
     *   It then updates the texture and emits an 'update' event with the current state.
     *
     * - On mouseup, it finalizes the current interaction:
     *   If the deletion flag is set, the active decal is removed.
     *   All interaction flags are reset and controls are re-enabled.
     *   Finally, the SVG texture is updated and an 'update' event is emitted.
     *
     * @remarks
     * This method ensures that the decal transformations, texture updates, and event emissions operate in sync during user interactions.
     */
    private initEventListeners() {
        window.addEventListener('mousedown', (event: MouseEvent) => {
            if (!this.interactionEnabled || !this.svgElement || event.target !== this.renderer.domElement) return;

            this.startScalePos = {x: event.clientX, y: event.clientY};

            const intersects = this.getMouseIntersections(event);
            const decalIntersected = this.selectDecalInIntersection(intersects);
            const controlIntersected = this.useControlByClickedPosition(intersects);
            const contentIntersected = this.useContentByClickedPosition(intersects);
            const updatedSVGContent = this.XMLSerializer.serializeToString(this.svgElement);

            console.log('intersects[0].uv', intersects[0].uv, intersects[0].point, intersects[0].object, intersects[0].normal);

            console.log('controlIntersected', controlIntersected);
            console.log('contentIntersected', contentIntersected);

            this.dragging = decalIntersected && contentIntersected !== null;
            this.rotating = decalIntersected && controlIntersected !== null && controlIntersected.getAttribute(this.ATTR_NAME) === this.ATTR_CONTROL_ROTATE;
            this.scaling = decalIntersected && controlIntersected !== null && controlIntersected.getAttribute(this.ATTR_NAME) === this.ATTR_CONTROL_SCALE;
            this.deleting = decalIntersected && controlIntersected !== null && controlIntersected.getAttribute(this.ATTR_NAME) === this.ATTR_CONTROL_DELETE;
            this.controls.enablePan = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableZoom = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableRotate = !this.dragging && !this.rotating && !this.scaling;

            this.decalSVGTexture?.updateSVGTexture();

            if (decalIntersected) {
                const activeDecal = this.svgElement.querySelector(`g[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`) as SVGGraphicsElement | null;
                
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
            if (!this.interactionEnabled || this.updating) return;

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
                    const activeDecal = this.svgElement?.querySelector(`g[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`) as SVGGraphicsElement | null;
                
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
            if (this.deleting) {
                this.deleteDecal();
            }

            this.dragging = false;
            this.rotating = false;
            this.scaling = false;
            this.deleting = false;

            this.controls.enablePan = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableZoom = !this.dragging && !this.rotating && !this.scaling;
            this.controls.enableRotate = !this.dragging && !this.rotating && !this.scaling;

            if (this.interactionEnabled) {
                this.decalSVGTexture?.updateSVGTexture();
    
                this.emit('update', [{ event, dragging: this.dragging }]);
            }
        });
    }

    /**
     * Computes the intersections between the mouse pointer and the scene's objects using raycasting.
     *
     * This method transforms the mouse coordinates from the event into normalized device coordinates 
     * relative to the target canvas element's bounding client rectangle. It then casts a ray from the camera 
     * into the scene and returns the intersection details.
     *
     * @param event - The mouse event containing the clientX and clientY values and a target canvas element.
     * @returns An array of THREE.Intersection objects representing the intersections with the scene's children.
     *          If the event target is not an HTMLCanvasElement, an empty array is returned.
     */
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

    /**
     * Converts a point in UV space to barycentric coordinates relative to a triangle defined by vertices a, b, and c.
     *
     * This method computes the barycentric coordinates (u, v, w) for the given point 'p' with respect to the triangle
     * formed by vertices 'a', 'b', and 'c'. The computation is based on vector arithmetic, using the differences between 
     * the vertices and the point to determine how 'p' relates to the triangle's edges.
     *
     * @param p - The point in UV space to be converted.
     * @param a - The first vertex of the triangle.
     * @param b - The second vertex of the triangle.
     * @param c - The third vertex of the triangle.
     * @returns A THREE.Vector3 representing the barycentric coordinates (u, v, w) if the triangle is valid; otherwise, null 
     * if the triangle is degenerate (i.e., the computed denominator is zero).
     */
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

    /**
     * Computes the world coordinate of a point on a mesh based on a provided UV coordinate.
     *
     * This method iterates through each triangle of the object's geometry to determine if the provided
     * UV coordinate lies within that triangle using barycentric coordinates. If the UV coordinate is found
     * within a triangle, the corresponding vertex positions are interpolated using the barycentric weights.
     * The calculated local position is then transformed to world space and returned.
     *
     * @param object - The THREE.Object3D instance (typically a THREE.Mesh) containing geometry with both position and UV attributes.
     * @param uv - The target UV coordinate (THREE.Vector2) to locate on the mesh's surface.
     * 
     * @returns A THREE.Vector3 representing the world coordinate of the point on the mesh corresponding to the provided UV.
     *          If the UV coordinate is not inside any triangle, a zero vector is returned.
     */
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
    

    /**
     * Projects a 3D scene point onto the 2D screen space.
     *
     * This method takes a point from the 3D scene, projects it to normalized device coordinates 
     * using the current camera, and then maps those coordinates to pixel values on the renderer's 
     * canvas. The calculation accounts for the renderer's pixel ratio and rounds the resulting 
     * coordinates to the nearest integer.
     *
     * @param scenePoint - The 3D vector (THREE.Vector3) representing the point in the scene.
     * @returns A 2D vector (THREE.Vector2) representing the corresponding point on the canvas.
     */
    private reverseRaycast(scenePoint: THREE.Vector3): THREE.Vector2 {
        const canvas = this.renderer.domElement;

        const point = scenePoint.clone();
        
        point.project(this.camera);

        const screenPoint = new THREE.Vector2();
        
        screenPoint.x = Math.round((0.5 + point.x / 2) * (canvas.width / this.renderer.getPixelRatio()));
        screenPoint.y = Math.round((0.5 - point.y / 2) * (canvas.height / this.renderer.getPixelRatio()));

        return screenPoint;
    }
    
    /**
     * Computes the bounding box for a given SVG element and optionally scales it based on a decal attribute.
     *
     * @param element - The SVGGraphicsElement whose bounding box is computed using its own dimensions.
     * @param decal - The SVG element from which the scale factor is retrieved via the `ATTR_SCALE` attribute.
     * @param scaled - A boolean flag indicating whether to apply scaling to the computed bounding box.
     *
     * @returns A DOMRect representing the adjusted bounding box of the element, or null if the element is not an SVGGraphicsElement.
     *
     * @remarks
     * If `scaled` is true, the function retrieves the scale factor from the decal's `ATTR_SCALE` attribute, adjusts the width and height of the bounding box,
     * and repositions the bounding box so that it remains centered relative to its original dimensions.
     */
    private getElementBBox(element: SVGGraphicsElement, decal: SVGElement, scaled: boolean): DOMRect | null {
        if (!(element instanceof SVGGraphicsElement)) return null;

        const bbox = element?.getBBox({stroke: true});

        if (!scaled) return bbox;

        const scaleFactor = parseFloat(decal.getAttribute(this.ATTR_SCALE) || '1');
        const initialWidth = bbox.width;
        const initialHeight = bbox.height;

        bbox.width *= scaleFactor;
        bbox.height *= scaleFactor;

        bbox.x -= (bbox.width - initialWidth) / 2;
        bbox.y -= (bbox.height - initialHeight) / 2;

        return bbox;
    }

    /**
     * Retrieves the SVG graphical element corresponding to the specified UV coordinates.
     *
     * This method calculates the absolute position in the SVG's coordinate space by using the
     * provided UV values and the dimensions of the SVG element. It then iterates through all SVG
     * elements marked with an attribute containing "decal", and for each, it checks if the computed
     * position (xPos, yPos) lies within the element's bounding box.
     *
     * @param uv - A THREE.Vector2 representing the UV coordinates where the decal should be found.
     * @returns The SVG element (of type SVGGraphicsElement) containing the decal if the position
     *          falls within its bounding box; otherwise, returns null.
     */
    private getDecalElementByUV(uv: THREE.Vector2): Element | null {
        if (!this.svgElement) return null;

        const decals = this.svgElement.querySelectorAll(`[${this.ATTR_NAME}*="decal"]`);

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

    /**
     * Returns the SVG control (button) element corresponding to the given UV coordinates.
     *
     * This method calculates the position within the SVG element based on the provided UV coordinates.
     * It first retrieves the active decal control element (if any) within the SVG, then iterates over the
     * available control buttons contained in that element. For each button, it computes the bounding box,
     * taking into account any applied SVG transformations. The UV coordinates are scaled to the SVG's dimensions,
     * and if they fall within a button's transformed bounding box, that button is returned.
     *
     * @param uv - A THREE.Vector2 representing the UV coordinates with components in the range [0, 1].
     * @returns The SVG graphics element that contains the control if found; otherwise, null.
     */
    private getControlElementByUV(uv: THREE.Vector2): Element | null {
        if (!this.svgElement) return null;

        const activeDecalControlElement = this.svgElement.querySelector(`[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"] [${this.ATTR_NAME}="${this.ATTR_CONTROLS}"]`);
        const buttons = activeDecalControlElement?.querySelectorAll(`[${this.ATTR_NAME}*="control-"]`);

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

    /**
     * Retrieves the SVG inner content element (text, image, etc.) corresponding to the active decal based on the given UV coordinate.
     *
     * The method first determines if the SVG element and an active decal with its container and content elements are present.
     * It then maps the provided UV coordinates to SVG dimensions and calculates the precise position. If the calculated
     * position falls within the bounding box of the active decal container, the associated content element is returned.
     *
     * @param uv - A THREE.Vector2 representing the UV coordinate (with x and y values normalized between 0 and 1),
     *             which is mapped to the SVG's width and height respectively.
     *
     * @returns The SVG content element if the UV coordinate is within the active decal container's bounding box; otherwise, returns null.
     *
     * @remarks This method assumes the existence of specific attributes on the SVG elements used to denote active decals,
     * and relies on calculating bounding box information to determine if the coordinate is inside the target area.
     */
    private getContentElementByUV(uv: THREE.Vector2): Element | null {
        if (!this.svgElement) return null;

        const activeDecalElement = this.svgElement.querySelector(`[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`);
        const activeDecalContainerElement = this.svgElement.querySelector(`[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"] [${this.ATTR_NAME}="${this.ATTR_CONTAINER}"]`);
        const activeDecalContentElement = this.svgElement.querySelector(`[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"] [${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);

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

    /**
     * Selects and activates a decal element based on provided 3D intersections.
     *
     * This method processes the intersection data from a raycast operation to determine if a valid decal element 
     * (represented as an SVGGraphicsElement) is intersected. It calculates the decal's center in UV-space using its 
     * bounding box, converts these coordinates to corresponding mesh and screen positions, and computes relative values 
     * for dragging, rotating, and scaling interactions. If a valid decal is detected, it records initial interaction 
     * parameters, activates the decal, and emits a 'click' event with relevant data. Otherwise, it ensures that all 
     * decals are deactivated.
     *
     * @param intersects - An array of THREE.Intersection objects resulting from a raycast, where the first intersection
     * indicates the potential decal target.
     *
     * @returns A boolean value indicating whether a suitable decal was successfully found and selected.
     */
    private selectDecalInIntersection(intersects: THREE.Intersection[]): boolean {
        let decalFound = false;

        if (intersects.length > 0) {
            const intersected = intersects[0];
            const uv = intersected.uv?.clone();

            if (uv) {
                const svgDecalElement = this.getDecalElementByUV(uv);
                const decalContent = svgDecalElement?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);

                if (svgDecalElement instanceof SVGGraphicsElement && decalContent instanceof SVGGraphicsElement) {
                    /** Calculate the center of the decal in UV coordinates */
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

                    console.log('meshPointByDecalCenter', meshPointByDecalCenter);

                    /** Save the initial values */
                    this.startDragCoordinates = new THREE.Vector2(
                        uv.x - ((bbox.x) / svgWidth),
                        uv.y - ((bbox.y) / svgHeight)
                    );
                    this.startScaleCenter = screenPointForDecalCenter;
                    this.savedRotateAngle = parseFloat(svgDecalElement.getAttribute(this.ATTR_ROTATE) || '0');
                    this.savedScale = parseFloat(svgDecalElement.getAttribute(this.ATTR_SCALE) || '1');
                    this.distanceFromCenterOnStart = Math.sqrt(deltaX ** 2 + deltaY ** 2);
                    this.startRotateAngle = angleRadians * (180 / Math.PI);

                    /** Highlight the selected decal */
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

    /**
     * Retrieves a control element based on the UV coordinate from the first valid intersection.
     *
     * This method processes an array of THREE.Intersection objects. If at least one intersection
     * exists and has a valid UV property, it retrieves and returns the corresponding control element
     * using the UV coordinate. Otherwise, it returns null.
     *
     * @param intersects - An array of THREE.Intersection objects to be evaluated.
     * @returns The control element corresponding to the first valid UV coordinate, or null if none
     *          is found.
     */
    private useControlByClickedPosition(intersects: THREE.Intersection[]): Element | null {
        if (intersects.length > 0 && intersects[0].uv) {
            return this.getControlElementByUV(intersects[0].uv);
        } else {
            return null;
        }
    }

    /**
     * Returns the content element corresponding to the clicked position based on the provided intersections.
     *
     * This method checks if the intersections array is not empty and if the first intersect has valid UV coordinates.
     * If valid, it retrieves the content element using the UV coordinates via the getContentElementByUV method.
     * Otherwise, it returns null.
     *
     * @param intersects - An array of THREE.Intersection objects captured from a raycasting event.
     * @returns The content Element associated with the UV coordinates of the first intersection, or null if no valid intersection exists.
     *
     * @private
     */
    private useContentByClickedPosition(intersects: THREE.Intersection[]): Element | null {
        if (intersects.length > 0 && intersects[0].uv) {
            return this.getContentElementByUV(intersects[0].uv);
        } else {
            return null;
        }
    }

    /**
     * Handles the drag event on a decal within the SVG element.
     *
     * This method checks for an active decal element marked as "decal" and active,
     * computes the intersection based on the mouse event's position, and updates the decal's
     * position accordingly. It serializes the updated SVG content and returns it as a string.
     *
     * @param event - The mouse event triggering the decal drag.
     * @returns The updated SVG content as a serialized string, or null if there is no active decal or SVG element.
     */
    private handleDragDecal(event: MouseEvent): string | null {
        const activeDecal = this.svgElement?.querySelector(`g[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`) as SVGGraphicsElement | null;

        console.timeLog('dragging', 'activeDecal');
        if (!this.svgElement || !activeDecal) return null;
        
        const intersects = this.getMouseIntersections(event);
        console.timeLog('dragging', 'getMouseIntersections');

        if (intersects.length > 0) {
            const intersected = intersects[0];
            const uv = intersected.uv?.clone();
            console.timeLog('dragging', 'get uv');

            if (uv) {
                const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
                const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');

                if (this.startDragCoordinates) {
                    uv.x -= this.startDragCoordinates.x;
                    uv.y -= this.startDragCoordinates.y;
                }

                this.updateDecal(activeDecal.getAttribute(this.ATTR_NAME) || '', {
                    x: uv.x * svgWidth,
                    y: uv.y * svgHeight,
                });

                console.timeLog('dragging', 'update svg');
            }
        }

        const updatedSVGContent = this.XMLSerializer.serializeToString(this.svgElement);
        console.timeLog('dragging', 'serializeToString svg');

        return updatedSVGContent;
    }

    /**
     * Handles the rotation of a decal based on the provided mouse event.
     *
     * This method locates the currently active decal and its corresponding content element,
     * computes the bounding box for the content element, and retrieves the mouse intersections.
     * It then calculates the new rotation angle by determining the angular offset between the
     * decal's center and the mouse pointer's UV coordinates, applying both a starting offset and
     * any previously saved rotation. The decal is then updated with the new rotation value.
     *
     * @param event - The MouseEvent that triggers the rotation handling.
     * @returns The serialized SVG content as a string with the updated decal rotation,
     * or null if the required SVG elements are not found or the rotation cannot be computed.
     */
    private handleRotateDecal(event: MouseEvent): string | null {
        const activeDecal = this.svgElement?.querySelector(`g[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`) as SVGGraphicsElement | null;
        const contentElement = activeDecal?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);
        
        if (!this.svgElement || !activeDecal || !(contentElement instanceof SVGGraphicsElement)) return null;
        
        const contentBBox = this.getElementBBox(contentElement, activeDecal, false);
        const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
        const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
        const intersects = this.getMouseIntersections(event);

        if (contentBBox && intersects.length > 0) {
            const intersected = intersects[0];
            const uv = intersected.uv?.clone();
            
            if (!uv) return null;
    
            const centerX = (contentBBox.x + (contentBBox.width * 0.5)) / svgWidth;
            const centerY = (contentBBox.y + (contentBBox.height * 0.5)) / svgHeight;
            const angleRadians = Math.atan2(uv.y - centerY, uv.x - centerX);
            let deg = ((angleRadians * (180 / Math.PI) + 360)) % 360;
    
            deg -= this.startRotateAngle; // offset
            deg += this.savedRotateAngle; // previous value
    
            this.updateDecal(activeDecal.getAttribute(this.ATTR_NAME) || '', {
                rotate: deg % 360
            });
        }

        const updatedSVGContent = this.XMLSerializer.serializeToString(this.svgElement);

        return updatedSVGContent;
    }

    /**
     * Updates the scale of the active decal element based on the current mouse position.
     *
     * This method calculates the distance between the mouse event's current position and the scale's center,
     * then adjusts the scale of the active decal proportionally. It updates the decal's attributes with the new scale,
     * serializes the updated SVG element to a string, and returns that string. If the SVG element, active decal, or 
     * required content element is not found, the method returns null.
     *
     * @param event - The mouse event that provides the current x and y coordinates for scaling.
     * @returns The updated SVG content as a string if scaling was applied; otherwise, null.
     */
    private handleScaleDecal(event: MouseEvent): string | null {
        const activeDecal = this.svgElement?.querySelector(`g[${this.ATTR_NAME}*="decal"][${this.ATTR_ACTIVE}="true"]`) as SVGGraphicsElement | null;
        const contentElement = activeDecal?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);
        
        if (!this.svgElement || !activeDecal || !(contentElement instanceof SVGGraphicsElement)) return null;
        
        const deltaX = event.clientX - this.startScaleCenter.x;
        const deltaY = event.clientY - this.startScaleCenter.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const scale = this.savedScale * distance / this.distanceFromCenterOnStart;

        this.updateDecal(activeDecal.getAttribute(this.ATTR_NAME) || '', {
            scale: scale
        });

        const updatedSVGContent = this.XMLSerializer.serializeToString(this.svgElement);

        return updatedSVGContent;
    }

    /**
     * Activates the specified decal by applying an active state and a dashed border style,
     * while deactivating all other decals.
     *
     * This method sets the active attribute of the given decal element to "true" and adds the
     * "dashed-border" class to its container element. It then iterates through all sibling decals
     * (identified by an attribute containing "decal") and deactivates them by setting their active
     * attribute to "false" and removing the border styling from their container elements.
     *
     * @param decal - The SVGGraphicsElement representing the decal to be activated.
     */
    private activateDecal(decal: SVGGraphicsElement): void {
        const containerElement = decal.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTAINER}"]`);
        
        decal.setAttribute(this.ATTR_ACTIVE, 'true');
        containerElement?.setAttribute('class', 'dashed-border');

        this.svgElement?.querySelectorAll(`[${this.ATTR_NAME}*="decal"]`).forEach((el) => {
            if (el !== decal) {
                const inactiveContainerElement = el.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTAINER}"]`);

                el.setAttribute(this.ATTR_ACTIVE, 'false');
                inactiveContainerElement?.removeAttribute('class');
            }
        });
    }

    /**
     * Deactivates all decals by updating their active state and cleaning up associated container classes.
     *
     * This method searches within the SVG element for all elements that have an attribute containing the string "decal".
     * For each matching element, it performs the following actions:
     * - Finds the container element identified by a specific container attribute (ATTR_CONTAINER).
     * - Sets the active attribute (ATTR_ACTIVE) of the element to 'false' to mark it as inactive.
     * - Removes any class attribute from the container element to clear any active styling.
     *
     * @remarks
     * Ensure that the attributes (ATTR_NAME, ATTR_CONTAINER, and ATTR_ACTIVE) are properly defined and 
     * that the SVG element is correctly initialized before invoking this method.
     *
     * @example
     * const svgDecals = new SvgDecals();
     * svgDecals.deactivateAllDecals();
     */
    public deactivateAllDecals(): void {
        this.svgElement?.querySelectorAll(`[${this.ATTR_NAME}*="decal"]`).forEach((el) => {
            const inactiveContainerElement = el.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTAINER}"]`);

            el.setAttribute(this.ATTR_ACTIVE, 'false');
            inactiveContainerElement?.removeAttribute('class');
        });
    }

    /**
     * Generates a random ray from a point outside the main model towards its bounding center 
     * and returns the first valid intersection with mesh objects that belong to the main model.
     *
     * This method calculates the bounding box of the main model to compute its size and center,
     * then creates a random starting point on the x and y axes (with a fixed z position coming from the camera).
     * A ray is then cast from this starting point towards the center of the bounding box.
     *
     * The raycaster is used to find intersections with objects in the scene. Only intersections with objects of type "Mesh"
     * that are part of the main model (either the model itself or its children) are considered valid.
     *
     * If a valid intersection is found, an array of intersections is returned. If no valid intersection is found and the allowed
     * number of attempts has not been exhausted, the method decrements the attempt counter and recursively tries again.
     *
     * @returns An array of THREE.Intersection objects if a valid intersection is found, or undefined if no valid intersection
     * is detected after the allowed number of attempts.
     */
    private generateRandomRay (): THREE.Intersection[] | undefined {
        if (!this.mainModel) {
            console.warn('Main model is not set.');
            return;
        }

        const boundingBox = new THREE.Box3().setFromObject(this.mainModel);
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
                if (currentObject === this.mainModel || currentObject.name === this.mainModel?.name) {
                    return true;
                }
                currentObject = currentObject.parent;
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

    /**
     * Creates an SVG group element that contains control buttons for rotating, scaling,
     * and deleting.
     *
     * This function builds and configures an SVG <g> element that serves as a container
     * for three control icons:
     * - A rotate icon: a <path> element with defined stroke properties and a transformation.
     * - A scale icon: a <g> element with its innerHTML set to SVG paths defining the scale icon.
     * - A delete icon: a <path> element with fill properties to represent a delete action.
     *
     * Each icon in the group is assigned a custom attribute (identified by this.ATTR_NAME)
     * corresponding to its control function (rotate, scale, or delete), allowing for easy
     * identification and handling in event listeners or other logic.
     *
     * @returns The SVGGraphicsElement representing the group of control buttons.
     */
    private createControlButtonsGroup(): SVGGraphicsElement {
        const controlsGroup = document.createElementNS(this.SVG_NS, 'g');
        const rotateIcon = document.createElementNS(this.SVG_NS, 'path');
        const scaleIcon = document.createElementNS(this.SVG_NS, 'g');
        const deleteIcon = document.createElementNS(this.SVG_NS, 'path');

        rotateIcon.setAttribute('fill', 'none');
        rotateIcon.setAttribute('stroke', 'currentColor');
        rotateIcon.setAttribute('stroke-linecap', 'round');
        rotateIcon.setAttribute('stroke-linejoin', 'round');
        rotateIcon.setAttribute('stroke-width', '2');
        rotateIcon.setAttribute('d', 'M19.95 11a8 8 0 1 0-.5 4m.5 5v-5h-5');
        rotateIcon.setAttribute(this.ATTR_NAME, this.ATTR_CONTROL_ROTATE);
        rotateIcon.setAttribute('transform', 'translate(0, 0)');

        scaleIcon.setAttribute('fill', 'none');
        scaleIcon.setAttribute(this.ATTR_NAME, this.ATTR_CONTROL_SCALE);
        scaleIcon.innerHTML = `<path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z"></path><path fill="currentColor" d="M11 3a1 1 0 0 1 .117 1.993L11 5H5v14h14v-6a1 1 0 0 1 1.993-.117L21 13v6a2 2 0 0 1-1.85 1.995L19 21H5a2 2 0 0 1-1.995-1.85L3 19V5a2 2 0 0 1 1.85-1.995L5 3zm8.75 0c.69 0 1.25.56 1.25 1.25V8a1 1 0 1 1-2 0V6.414L12.414 13H14a1 1 0 1 1 0 2h-3.75C9.56 15 9 14.44 9 13.75V10a1 1 0 0 1 2 0v1.586L17.586 5H16a1 1 0 1 1 0-2z"></path>`;

        deleteIcon.setAttribute(this.ATTR_NAME, this.ATTR_CONTROL_DELETE);
        deleteIcon.setAttribute('fill', 'currentColor');
        deleteIcon.setAttribute('d', 'M7 21q-.825 0-1.412-.587T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413T17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2zM7 6v13z');

        controlsGroup.appendChild(rotateIcon);
        controlsGroup.appendChild(scaleIcon);
        controlsGroup.appendChild(deleteIcon);
        controlsGroup.setAttribute(this.ATTR_NAME, this.ATTR_CONTROLS);

        return controlsGroup;
    }

    /**
     * Creates the main parent SVG group element for a decal.
     *
     * This method builds the hierarchical structure of SVG group elements required for the decal,
     * which includes a container for content and control buttons. The structure is composed as follows:
     * - A primary group element that serves as the decal's parent.
     * - A container group, annotated with a specific attribute, that encapsulates:
     *   - A content group identified by a dedicated attribute.
     * - A controls group is appended to manage interaction elements (e.g., control buttons).
     *
     * @param decalName - A string representing the name to assign to the decal group element.
     *                    This name is set as an attribute value on the main parent group element.
     *
     * @returns The complete SVGGraphicsElement representing the decal, or null if the base SVG element is unavailable.
     */
    private createDecalMainParentElement(decalName: string): SVGGraphicsElement | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }
        
        const group = document.createElementNS(this.SVG_NS, 'g');
        const container = document.createElementNS(this.SVG_NS, 'g');
        const contentGroup = document.createElementNS(this.SVG_NS, 'g');
        const controlsGroup = this.createControlButtonsGroup();
        
        contentGroup.setAttribute(this.ATTR_NAME, this.ATTR_CONTENT);
        container.setAttribute(this.ATTR_NAME, this.ATTR_CONTAINER);
        container.appendChild(contentGroup);
        group.appendChild(container);
        group.appendChild(controlsGroup);

        group.setAttribute(this.ATTR_NAME, `${decalName}`);

        return group;
    }

    /**
     * Creates a text decal on an SVG element at a specified position.
     *
     * This method generates a new decal group and appends a text element to it. The text element's position is determined by the provided UV coordinates scaled according to the SVG element's width and height. The method also sets various text styling attributes such as font size, text-anchor, fill, and font-family. If the SVG element is not available, the function logs a warning and returns null.
     *
     * @param uv - The UV coordinates used to calculate the position within the SVG element.
     * @param decalName - A unique identifier used for creating and referencing the decal group.
     * @param text - The textual content to be rendered within the text element.
     * @param size - The font size to assign to the text element.
     * @returns The SVG graphics element representing the assembled decal group with the text element,
     *          or null if the SVG element is not available.
     */
    private createTextDecal(uv: THREE.Vector2, decalName: string, text: string, size: number): SVGGraphicsElement | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }

        const decalGroup = this.createDecalMainParentElement(decalName);
        const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
        const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
        const textElement = document.createElementNS(this.SVG_NS, 'text');
        const contentGroup = decalGroup?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);

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
            textElement.setAttribute(this.ATTR_NAME, this.ATTR_TEXT);
            textElement.textContent = text;

            // Append both to the group
            contentGroup.appendChild(textElement);
            decalGroup.setAttribute(this.ATTR_POSX, x.toString());
            decalGroup.setAttribute(this.ATTR_POSY, y.toString());
        }

        return decalGroup;
    }

    /**
     * Creates an image decal element within the SVG using provided UV coordinates, decal name, image source, and size.
     *
     * This method calculates the position of the decal based on the SVG's dimensions and the provided UV coordinate,
     * then creates and positions an SVG image element accordingly. If the main SVG element is not available,
     * the method returns null.
     *
     * @param uv - The UV coordinates to determine the position of the decal within the SVG.
     * @param decalName - The name to assign to the decal group element for identification.
     * @param image - A Base64 URL string representing the image to be used as the decal.
     * @param size - The size to be applied to both the width and height of the decal image.
     * @returns The created SVG graphic element representing the decal or null if the SVG element is not available.
     */
    private createImageDecal(uv: THREE.Vector2, decalName: string, image: Base64URLString, size: number): SVGGraphicsElement | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }

        const decalGroup = this.createDecalMainParentElement(decalName);
        const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
        const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
        const contentGroup = decalGroup?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);
        const imageElement = document.createElementNS(this.SVG_NS, 'image');

        // Position
        const x = uv.x * svgWidth;
        const y = uv.y * svgHeight;

        if (decalGroup && contentGroup) {
            imageElement.setAttribute('x', x.toString());
            imageElement.setAttribute('y', y.toString());
            imageElement.setAttribute('width', size.toString());
            imageElement.setAttribute('height', size.toString());
            imageElement.setAttribute('href', image);
            imageElement.setAttribute(this.ATTR_NAME, this.ATTR_IMAGE);
            imageElement.setAttribute('preserveAspectRatio', 'xMinYMin meet');
            imageElement.setAttribute('fill', 'black');
            // Append both to the group
            contentGroup.appendChild(imageElement);
            decalGroup.setAttribute(this.ATTR_POSX, x.toString());
            decalGroup.setAttribute(this.ATTR_POSY, y.toString());
        }

        return decalGroup;
    }

    /**
     * Creates a new icon decal SVG element and appends the provided icon to it.
     *
     * The method retrieves the global SVG element and calculates positioning based on the provided
     * UV coordinates and dimensions from the SVG. It then creates a decal group and appends a cloned version
     * of the provided icon (or its children, in case it's an SVGSVGElement) into the decal's content group.
     * It also sets various attributes (like position, color, and transform) on the icon and the decal group.
     *
     * @param uv - The UV coordinates used to calculate the icon's position on the SVG canvas.
     * @param decalName - A string denoting the name for the decal, used in creating and referencing the decal group.
     * @param icon - The SVG element representing the icon; can be an SVGSVGElement with child nodes or any SVGElement.
     * @returns The decal group element with the appended icon if successful, or null if the main SVG element is not available.
     */
    private createIconDecal(uv: THREE.Vector2, decalName: string, icon: SVGElement): SVGGraphicsElement | null {
        if (!this.svgElement) {
            console.warn('SVG element is not available.');
            return null;
        }

        const decalGroup = this.createDecalMainParentElement(decalName);
        const svgWidth = parseFloat(this.svgElement.getAttribute('width') || '100');
        const svgHeight = parseFloat(this.svgElement.getAttribute('height') || '100');
        const contentGroup = decalGroup?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTENT}"]`);
        const iconElement = document.createElementNS(this.SVG_NS, 'g');
        let fillAttr;
        let strokeAttr;
        let colorVal = 'black';

        if (icon instanceof SVGSVGElement) {
            Array.from(icon.childNodes).forEach((child) => {
                if (child.nodeType === Node.ELEMENT_NODE && child instanceof Element) {
                    fillAttr = child.getAttribute('fill');
                    strokeAttr = child.getAttribute('stroke');

                    iconElement.appendChild(child.cloneNode(true));
                }
            });
        } else {
            fillAttr = icon.getAttribute('fill');
            strokeAttr = icon.getAttribute('stroke');

            iconElement.appendChild(icon.cloneNode(true));
        }

        if (fillAttr && fillAttr !== 'none') {
            colorVal = fillAttr;
        } else if (strokeAttr && strokeAttr !== 'none') {
            colorVal = strokeAttr;
        }

        // Position
        const x = uv.x * svgWidth;
        const y = uv.y * svgHeight;

        if (decalGroup && contentGroup) {
            iconElement.setAttribute('x', x.toString());
            iconElement.setAttribute('y', y.toString());
            iconElement.setAttribute(this.ATTR_NAME, this.ATTR_ICON);
            iconElement.setAttribute('transform', `translate(${x}, ${y})`);
            contentGroup.appendChild(iconElement);

            decalGroup.setAttribute(this.ATTR_COLORVAL, colorVal);
            decalGroup.setAttribute(this.ATTR_POSX, x.toString());
            decalGroup.setAttribute(this.ATTR_POSY, y.toString());
        }

        return decalGroup;
    }

    /**
     * Updates the positions of the control elements for a given SVG decal.
     *
     * This method locates specific container and control groups within the provided SVG decal by querying
     * using predefined attribute names. It computes the bounding box of the container group, and if available,
     * applies translation transforms to reposition:
     *   - The main control group, aligning it based on the container's x, y coordinates and dimensions.
     *   - The rotate icon, offset relative to the container's dimensions.
     *   - The delete icon, positioned relative to the container's width.
     *
     * @param decal - The SVG element representing the decal that contains container and control sub-elements.
     *
     * @remarks
     * The method is designed to work with SVG elements that follow a specific structure where container and
     * control groups are identified by certain attribute names.
     *
     * @private
     */
    private updateControlsPosition(decal: SVGGraphicsElement): void {
        const containerGroup = decal.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTAINER}"]`);
        const controlGroup = decal.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTROLS}"]`);
        const rotateIcon = controlGroup?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTROL_ROTATE}"]`);
        const deleteIcon = controlGroup?.querySelector(`[${this.ATTR_NAME}="${this.ATTR_CONTROL_DELETE}"]`);

        if (containerGroup instanceof SVGGraphicsElement) {
            const containerBBox = this.getElementBBox(containerGroup, decal, false);

            if (!containerBBox) return;

            if (controlGroup instanceof SVGGraphicsElement) {
                controlGroup.setAttribute('transform', `translate(${containerBBox.x - 30}, ${containerBBox.y + containerBBox.height - 20})`);
            }
            if (rotateIcon instanceof SVGGraphicsElement) {
                rotateIcon.setAttribute('transform', `translate(${containerBBox.width + 36}, ${-containerBBox.height + 16})`);
            }
            if (deleteIcon instanceof SVGGraphicsElement) {
                deleteIcon.setAttribute('transform', `translate(${containerBBox.width + 10}, 24)`);
            }
        }
    }
}
