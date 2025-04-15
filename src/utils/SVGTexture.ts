import * as THREE from 'three';

export class SVGTexture {
    private svgElement: SVGSVGElement | null = null;
    private canvas: OffscreenCanvas | null = null;
    private canvasTexture: THREE.CanvasTexture | null = null;
    private static idCounter = 0;
    private uniqueId: string;

    constructor(svgContent: string, material: THREE.MeshStandardMaterial) {
        this.uniqueId = `${material.name || ''}.${SVGTexture.idCounter++}`;

        if (Array.isArray(material)) {
            material.forEach(material => {
                if (material instanceof THREE.Material && 'map' in material) {
                    material.map = this.createTexture();
                }
            });
        } else if ('map' in material) {
            material.map = this.createTexture();
        }


        this.createHiddenElement(svgContent);
        this.updateSVGTexture();
    }

    private createTexture(): THREE.CanvasTexture {
        this.canvas = new OffscreenCanvas(4096, 4096);
        this.canvasTexture = new THREE.CanvasTexture(this.canvas);

        return this.canvasTexture;
    }

    private createHiddenElement(svgContent: string): HTMLElement {
        const hiddenElement = document.createElement('div');

        hiddenElement.style.position = 'absolute';
        hiddenElement.style.left = '-9999px';
        hiddenElement.style.top = '-9999px';
        hiddenElement.style.visibility = 'hidden';
        hiddenElement.innerHTML = svgContent;

        document.body.appendChild(hiddenElement);
        this.svgElement = hiddenElement.querySelector('svg') as SVGSVGElement;

        return hiddenElement;
    }

    public updateSVGTexture(cb: () => void = () => {}): void {
        if (!this.canvas) {
            console.error('Canvas is not initialized');
            return;
        }

        const ctx = this.canvas.getContext('2d');

        console.time(`updateSVGTexture ${this.uniqueId}`);

        if (ctx) {
            const img = new Image();

            img.onload = () => {
                ctx.clearRect(0, 0, this.canvas?.width || 100, this.canvas?.height || 100);
                ctx.drawImage(img, 0, 0, this.canvas?.width || 100, this.canvas?.height || 100);


                console.timeLog(`updateSVGTexture ${this.uniqueId}`, 'drawImage');

                if (this.canvasTexture) {
                    this.canvasTexture.needsUpdate = true;
                }

                cb?.();
                console.timeEnd(`updateSVGTexture ${this.uniqueId}`);
            };

            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svgElement?.outerHTML || '')}`;
        }
    }

    public getSVGElement(): SVGSVGElement | null {
        return this.svgElement;
    }

    public downloadSVG(filename: string = 'download.svg'): void {
        if (!this.svgElement) {
            console.error('SVG element is not initialized');
            return;
        }
        const blob = new Blob([this.svgElement.outerHTML], { type: 'image/svg+xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    public mergeAndDownloadSVG(svgElements: SVGSVGElement[], filename: string = 'merged.svg'): void {
        if (!svgElements || svgElements.length === 0) {
            console.error('No SVG elements provided for merging');
            return;
        }

        const mergedSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        mergedSVG.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        mergedSVG.setAttribute('width', '4096');
        mergedSVG.setAttribute('height', '4096');
        mergedSVG.setAttribute('viewBox', '0 0 4096 4096');

        svgElements.forEach((svgElement) => {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            
            Array.from(svgElement.children).forEach(child => {
                group.appendChild(child.cloneNode(true));
            });
            mergedSVG.appendChild(group);
        });

        const blob = new Blob([mergedSVG.outerHTML], { type: 'image/svg+xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}