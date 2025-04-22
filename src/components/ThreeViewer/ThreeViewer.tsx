import * as THREE from 'three';
import { useEffect, useCallback, useState, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; // Ensure GLTFLoader is included
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'; // Import OrbitControls
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'; // Import GLTF type
import GUI from 'lil-gui'
// import { Decals } from '../../utils/decals';
import { RGBELoader } from 'three/examples/jsm/Addons.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { SVGDecals } from '../../utils/SVGDecals';
import { SVGTexture } from '../../utils/SVGTexture';

interface ThreeViewerProps {
    modelUrl: string;
    environmentUrl?: string;
    textureColorUrl?: string;
    textureNormalUrl?: string;
    textureAmbientOcclusionUrl?: string;
    textureRoughnessUrl?: string;
}


const ThreeViewer: React.FC<ThreeViewerProps> = (props) => {
    const [modelLoaded, setModelLoaded] = useState(false);
    const [sceneReady, setSceneReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const loadingManager = useRef(new THREE.LoadingManager());
    const textureLoader = useRef(new THREE.TextureLoader(loadingManager.current));
    const scene = useRef(new THREE.Scene());
    const model = useRef<THREE.Object3D | null>(null);
    const camera = useRef<THREE.PerspectiveCamera | null>(null);
    const renderer = useRef(new THREE.WebGLRenderer({ antialias: true }));
    const gui = useRef<GUI|null>(null);
    const controls = useRef<OrbitControls | null>(null);
    const lights = useRef<THREE.Object3D[]>([]);
    const mountRef = useRef<HTMLDivElement | null>(null);
    const sizes = useRef({ width: 0, height: 0 });
    const aspectRatio = useRef(1);
    const animationFrame = useRef<number>(0);
    const allowAnimation = useRef<boolean>(false);
    const allowAnimationTimeout = useRef<number>(0);
    const decals = useRef<SVGDecals | null>(null);
    const svgBaseTextureInstance = useRef<SVGTexture | null>(null);
    const decalText = useRef<string>('Decal');
    const [selectedDecalData, setSelectedDecalData] = useState<{ id: string, text: string; color: string; scale: number; rotate: number; x: number; y: number } | null>(null);
    const decalProps = {
        text: '',
        color: '#a3e8ff',
        scale: 0,
        rotate: 0,
        x: 0,
        y: 0,
    };

    const loadModel = useCallback(() => {
        const gltfLoader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();

        dracoLoader.setDecoderPath('/draco/');
        gltfLoader.setDRACOLoader(dracoLoader);

        gltfLoader.load(
            props.modelUrl,
            (gltf: GLTF) => {
                model.current = gltf.scene;
                scene.current.add(model.current);
                
                setModelLoaded(true);
            },
            undefined,
            (error: unknown) => {
                if (error instanceof Error) {
                    console.error('An error occurred while loading the model:', error);
                    setError(error.message);
                } else {
                    console.error('An unknown error occurred while loading the model:', error);
                    setError('Unknown error occurred');
                }
            }
        );
    }, [props.modelUrl]);

    const setupLights = useCallback(() => {
        if (props.environmentUrl) {
            const rgbeLoader = new RGBELoader();

            rgbeLoader.load(props.environmentUrl, (envMap) => {
                envMap.mapping = THREE.EquirectangularRefractionMapping;
                scene.current.environment = envMap;
                scene.current.environmentIntensity = 2;
            });
        }

        const ambientLight = new THREE.AmbientLight(new THREE.Color(1, 1, 1), 2);
             
        scene.current.add(ambientLight);
        lights.current.push(ambientLight);
    }, []);

    const updateSizes = useCallback(() => {
        sizes.current.width = window.innerWidth;
        sizes.current.height = window.innerHeight;
        aspectRatio.current = sizes.current.width / sizes.current.height;

        if (camera.current) {
            camera.current.aspect = aspectRatio.current;
            camera.current.updateProjectionMatrix();
        }
        renderer.current.setSize(sizes.current.width, sizes.current.height);
        renderer.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        renderer.current.outputColorSpace = THREE.LinearSRGBColorSpace;
        renderer.current.toneMapping = THREE.NoToneMapping;
        renderer.current.toneMappingExposure = 2;
        updateRender();
    }, []);


    const initializeMaterials = useCallback(async () => {
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            name: 'baseMaterial',
            visible: true,
        });
        const SCALING = 2;

        await new Promise<void>(resolve => {
            if (props.textureColorUrl) {
                if (props.textureColorUrl.endsWith('.svg')) {
                    fetch(props.textureColorUrl)
                        .then(response => response.text())
                        .then(svgContent => {
                            svgBaseTextureInstance.current = new SVGTexture(svgContent, baseMaterial);

                            if (baseMaterial.map) {
                                baseMaterial.map.flipY = false;
                                baseMaterial.map.needsUpdate = true;
                            }

                            resolve();
                        })
                        .catch(error => {
                            console.error('Error loading SVG texture:', error);
                            resolve();
                        });
                } else {
                    baseMaterial.map = textureLoader.current.load(props.textureColorUrl, () => {
                        if (baseMaterial.map) {
                            baseMaterial.map.wrapS = THREE.RepeatWrapping;
                            baseMaterial.map.wrapT = THREE.RepeatWrapping;
                            baseMaterial.map.repeat.set(SCALING, SCALING);
                            baseMaterial.map.needsUpdate = true;
                        }
                        resolve();
                    });
                }
            } else {
                resolve();
            }
        });

        if (props.textureNormalUrl) {
            baseMaterial.normalMapType = THREE.TangentSpaceNormalMap;
            baseMaterial.normalMap = textureLoader.current.load(props.textureNormalUrl);
            baseMaterial.normalMap.wrapS = THREE.RepeatWrapping;
            baseMaterial.normalMap.wrapT = THREE.RepeatWrapping;
            baseMaterial.normalMap.repeat.set(SCALING, SCALING);
            baseMaterial.normalScale.set(0.5, 0.5);
        }
        if (props.textureAmbientOcclusionUrl) {
            baseMaterial.aoMap = textureLoader.current.load(props.textureAmbientOcclusionUrl);
            baseMaterial.aoMap.wrapS = THREE.RepeatWrapping;
            baseMaterial.aoMap.wrapT = THREE.RepeatWrapping;
            baseMaterial.aoMap.repeat.set(SCALING, SCALING);
        }
        if (props.textureRoughnessUrl) {
            baseMaterial.roughnessMap = textureLoader.current.load(props.textureRoughnessUrl);
            baseMaterial.roughnessMap.wrapS = THREE.RepeatWrapping;
            baseMaterial.roughnessMap.wrapT = THREE.RepeatWrapping;
            baseMaterial.roughnessMap.repeat.set(SCALING, SCALING);
        }

        model.current?.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.name.includes('glass')) {
                    child.material = new THREE.MeshPhysicalMaterial({
                        color: 0xffffff,
                        name: 'glassMaterial',
                        transparent: true,
                        opacity: 0.5,
                        transmission: 1,
                        roughness: 0,
                        ior: 1.5,
                        thickness: 0.1
                    });
                } else {
                    child.material = baseMaterial;
                }
                
            }
        });

        updateRender();
    }, [props]);

    const setupGUI = useCallback(() => {
        if (controls.current?.target && camera.current && !gui.current) {
            gui.current = new GUI({ width: 300 });
            gui.current.add(controls.current.target, 'y', -3, 3, 0.01).name('Controls Target Y').onChange(() => controls.current?.update());
            gui.current.add(controls.current.target, 'z', -3, 3, 0.01).name('Controls Target Z').onChange(() => controls.current?.update());
            gui.current.add(camera.current.position, 'z', -3, 3, 0.01).name('Camera Position Z').onChange(() => controls.current?.update());
            gui.current.add(camera.current.position, 'y', -3, 3, 0.01).name('Camera Position Y').onChange(() => controls.current?.update());

            gui.current.add(renderer.current, 'toneMapping', {
                No: THREE.NoToneMapping,
                Linear: THREE.LinearToneMapping,
                Reinhard: THREE.ReinhardToneMapping,
                Cineon: THREE.CineonToneMapping,
                ACESFilmic: THREE.ACESFilmicToneMapping
            });
            gui.current.add(renderer.current, 'outputColorSpace', {
                Linear: THREE.LinearSRGBColorSpace,
                sRGB: THREE.SRGBColorSpace,
            });

            gui.current.add(
                {
                    decalText: decalText.current
                },
                'decalText'
            )
            .name('New Decal Text')
            .onChange((value: string) => decalText.current = value);

            gui.current.add({
                addDecal: () => {
                    const newDecalName = decals.current?.putDecal(new THREE.Vector2(814, 1370), {
                        text: 'NEW DECAL',
                        fill: '#990061',
                        id: 'decal-wm4dgxf4wr',
                        rotate: 0
                    });

                    if (newDecalName) {
                        gui.current?.add({selectDecal: () => {
                            decals.current?.selectDecal(newDecalName);
                            updateRender();
                        }}, 'selectDecal').name(`Select ${newDecalName}`);
                        gui.current?.add({deleteDecal: () => {
                            decals.current?.deleteDecal(newDecalName);
                            updateRender();
                        }}, 'deleteDecal').name(`Delete ${newDecalName}`);
                    }
                    
            
                    updateRender();
                },
            }, 'addDecal').name('Add Predefined Decal');

            gui.current.add({
                addDecal: () => {
                    const newDecalName = decals.current?.putDecal(undefined, {text: decalText.current, fill: decalProps.color});

                    if (newDecalName) {
                        gui.current?.add({selectDecal: () => {
                            decals.current?.selectDecal(newDecalName);
                            updateRender();
                        }}, 'selectDecal').name(`Select ${newDecalName}`);
                        gui.current?.add({deleteDecal: () => {
                            decals.current?.deleteDecal(newDecalName);
                            updateRender();
                        }}, 'deleteDecal').name(`Delete ${newDecalName}`);
                    }
                    
            
                    updateRender();
                },
            }, 'addDecal').name('Add Text Decal');

            gui.current.add({
                addDecal: () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/svg+xml';
                    input.onchange = async (e: Event) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                            if (file.size > 1 * 1024 * 1024) {
                                alert('SVG file size must be less than 1MB.');
                                return;
                            }
                            const text = await file.text();
                            try {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(text, 'image/svg+xml');
                                const svg = doc.querySelector('svg');
                                if (svg instanceof SVGSVGElement) {
                                    const newDecalName = decals.current?.putDecal(undefined, { icon: svg });
                                    
                                    if (newDecalName) {
                                        gui.current?.add({selectDecal: () => {
                                            decals.current?.selectDecal(newDecalName);
                                            updateRender();
                                        }}, 'selectDecal').name(`Select ${newDecalName}`);
                                        gui.current?.add({deleteDecal: () => {
                                            decals.current?.deleteDecal(newDecalName);
                                            updateRender();
                                        }}, 'deleteDecal').name(`Delete ${newDecalName}`);
                                    }
                                    
                                    updateRender();
                                } else {
                                    alert('Invalid SVG file.');
                                }
                            } catch (err) {
                                console.error('Error parsing SVG:', err);
                                alert('Failed to parse SVG.');
                            }
                        }
                    };
                    input.click();
            
                    updateRender();
                },
            }, 'addDecal').name('Add Icon Decal');

            gui.current.add({
                addDecal: () => {
                    const input = document.createElement('input');

                    input.type = 'file';
                    input.accept = 'image/png, image/jpeg';
                    input.onchange = (e: Event) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                            if (file.size > 5 * 1024 * 1024) {
                                alert('File size must be less than 5MB.');
                                return;
                            }
                            const reader = new FileReader();
                            reader.onload = () => {
                                const base64String = `data:${file.type};base64,${btoa(
                                    new Uint8Array(reader.result as ArrayBuffer)
                                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                                )}`;
                                const newDecalName = decals.current?.putDecal(undefined, { image: base64String });

                                if (newDecalName) {
                                    gui.current?.add({selectDecal: () => {
                                        decals.current?.selectDecal(newDecalName);
                                        updateRender();
                                    }}, 'selectDecal').name(`Select ${newDecalName}`);
                                    gui.current?.add({deleteDecal: () => {
                                        decals.current?.deleteDecal(newDecalName);
                                        updateRender();
                                    }}, 'deleteDecal').name(`Delete ${newDecalName}`);
                                }

                                updateRender();
                            };
                            reader.readAsArrayBuffer(file);
                        }
                    };
                    input.click();
                },
            }, 'addDecal').name('Add Image Decal');

            gui.current.add({
                downloadDecalTexture: () => {
                    decals.current?.deactivateAllDecals();
                    SVGTexture.mergeAndDownloadSVG([decals.current?.getSVGElement()]);
                }
            }, 'downloadDecalTexture').name('Download Decal Texture');

            gui.current.add({
                downloadBaseTexture: () => {
                    decals.current?.deactivateAllDecals();
                    if (svgBaseTextureInstance.current) {
                        SVGTexture.mergeAndDownloadSVG([svgBaseTextureInstance.current.getSVGElement()]);
                    } else {
                        console.error('Base SVG texture not found');
                    }
                }
            }, 'downloadBaseTexture').name('Download Base SVG Texture');

            gui.current.add({
                downloadMergedTexture: () => {
                    const baseSVGTexture = svgBaseTextureInstance.current?.getSVGElement();
                    const decalSVGTexture = decals.current?.getSVGElement();
                    
                    decals.current?.deactivateAllDecals();

                    if (baseSVGTexture || decalSVGTexture) {
                        SVGTexture.mergeAndDownloadSVG([baseSVGTexture, decalSVGTexture]);
                    }
                }
            }, 'downloadMergedTexture').name('Download Merged SVG Texture');

            const decalFolder = gui.current.addFolder('Selected Decal Data');
            
            decalFolder.add(decalProps, 'text').name('Text');
            decalFolder.addColor(decalProps, 'color').name('Color');
            decalFolder.add(decalProps, 'scale', -10, 10, 0.001).name('Scale');
            decalFolder.add(decalProps, 'rotate', 0, 360, 0.001).name('Rotate');
            decalFolder.add(decalProps, 'x', 0, 3000, 0.001).name('X');
            decalFolder.add(decalProps, 'y', 0, 3000, 0.001).name('Y');


            gui.current.add({
                enableInteractions: () => {
                    if (decals.current) 
                        decals.current.decalInteractionsEnabled = true;
                },
            }, 'enableInteractions').name('Enable Interactions');

            gui.current.add({
                disableInteractions: () => {
                    if (decals.current) 
                        decals.current.decalInteractionsEnabled = false;
                },
            }, 'disableInteractions').name('Disable Interactions');


            gui.current.add({
                placeDecalMode: () => {
                    if (decals.current) 
                        decals.current.placeDecalModeEnabled = true;
                },
            }, 'placeDecalMode').name('Put Decal By click');

            gui.current.add({
                getDecalProps: () => {
                    const props = decals.current?.getDecalProperties();

                    console.log('Decal Properties:', props);
                },
            }, 'getDecalProps').name('Get Selected Decal Properties');
        }
    }, []);

    const updateDecalText = useCallback((value: string) => {
        if (selectedDecalData) decals.current?.updateDecal(selectedDecalData.id, {text: value});
        updateRender();
    }, [selectedDecalData]);

    const updateDecalColor = useCallback((value: string) => {
        if (selectedDecalData) decals.current?.updateDecal(selectedDecalData.id, {fill: value});
        updateRender();
    }, [selectedDecalData]);

    const updateDecalScale = useCallback((value: number) => {
        if (selectedDecalData) decals.current?.updateDecal(selectedDecalData.id, {scale: value});
        updateRender();
    }, [selectedDecalData]);

    const updateDecalRotate = useCallback((value: number) => {
        if (selectedDecalData) decals.current?.updateDecal(selectedDecalData.id, {rotate: value});
        updateRender();
    }, [selectedDecalData]);

    const updateDecalX = useCallback((value: number) => {
        if (selectedDecalData) decals.current?.updateDecal(selectedDecalData.id, {x: value});
        updateRender();
    }, [selectedDecalData]);

    const updateDecalY = useCallback((value: number) => {
        if (selectedDecalData) decals.current?.updateDecal(selectedDecalData.id, {y: value});
        updateRender();
    }, [selectedDecalData]);

    useEffect(() => {
        if (gui.current && selectedDecalData) {
            gui.current.folders[0].controllers[0].onChange(updateDecalText);
            gui.current.folders[0].controllers[0].setValue(selectedDecalData.text);
            gui.current.folders[0].controllers[1].onChange(updateDecalColor);
            gui.current.folders[0].controllers[1].setValue(selectedDecalData.color);
            gui.current.folders[0].controllers[2].onChange(updateDecalScale);
            gui.current.folders[0].controllers[2].setValue(selectedDecalData.scale);
            gui.current.folders[0].controllers[3].onChange(updateDecalRotate);
            gui.current.folders[0].controllers[3].setValue(selectedDecalData.rotate);
            gui.current.folders[0].controllers[4].onChange(updateDecalX);
            gui.current.folders[0].controllers[4].setValue(selectedDecalData.x);
            gui.current.folders[0].controllers[5].onChange(updateDecalY);
            gui.current.folders[0].controllers[5].setValue(selectedDecalData.y);
        }
    }, [selectedDecalData]);

    const initScene = useCallback(() => {
        if (mountRef.current && !sceneReady) {
            window.addEventListener('resize', updateSizes);

            loadModel();
            setupLights();
            updateSizes();

            renderer.current.setClearColor('#211d20');
            renderer.current.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.current.shadowMap.enabled = true;

            camera.current = new THREE.PerspectiveCamera(60, aspectRatio.current, 0.01, 200);
            controls.current = new OrbitControls(camera.current, renderer.current.domElement);
            mountRef.current.appendChild(renderer.current.domElement);
            controls.current.enableDamping = true;
            camera.current.position.z = 0.2;
            camera.current.position.y = 0.07;
            controls.current.target.set(0, 0, 0);

            controls.current?.update();

            setSceneReady(true);
        }
    }, [sceneReady]);

    const updateRender = useCallback(() => {
        allowAnimation.current = true;
        window.clearTimeout(allowAnimationTimeout.current);
        allowAnimationTimeout.current = window.setTimeout(() => {
            allowAnimation.current = false;
        }, 1000);
    }, []);

    useEffect(() => {
        const initDecals = async () => {
            if (modelLoaded && model.current && controls.current) {
                controls.current?.addEventListener('change', updateRender);
    
                await initializeMaterials();
    
                if (camera.current) {
                    decals.current = new SVGDecals(scene.current, model.current, camera.current, controls.current, renderer.current);

                    decals.current.on('update', (data: unknown) => {
                        const typedData = data as { 
                            event: MouseEvent, 
                            updatedSVGContent: string, 
                            dragging: boolean,
                            rotating: boolean,
                            scaling: boolean,
                            props: {
                                id: string;
                                text: string;
                                color: string;
                                scale: number;
                                rotate: number;
                                x: number;
                                y: number;
                            }
                        };
                        setSelectedDecalData(typedData.props || null);
                        updateRender();
                    });
                }
                
                setupGUI();
                updateRender();
            }
        }

        initDecals();
    }, [modelLoaded]);

    const render = useCallback(() => {
        if (allowAnimation.current) {
            if (camera.current) {
                renderer.current.render(scene.current, camera.current);
            }
            controls.current?.update();
        }
        animationFrame.current = window.requestAnimationFrame(render);
    }, []);


    useEffect(() => {
        if (mountRef.current) {
            initScene();
            render();
        }

        return () => {
            renderer.current.dispose();
            controls.current?.dispose();
            scene.current.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry.dispose();

                    for (const key in child.material) {
                        const value = child.material[key];

                        if (value && typeof value.dispose === 'function') {
                            value.dispose();
                        }
                    }
                }
            });
            lights.current = [];
            window.cancelAnimationFrame(animationFrame.current);
            window.removeEventListener('resize', updateSizes);
        };
    }, []);

    return (
        <div>
            <div ref={mountRef} />
            {!modelLoaded && <p>Loading model...</p>}
            {error && <p>Error: {error}</p>}
        </div>
    );
};

export default ThreeViewer;