import './App.css'
import ThreeViewer from './components/ThreeViewer/ThreeViewer'

function App() {

  return (
    <>
      <ThreeViewer 
        modelUrl="./models/glasses_fixed_uv_compress.glb"
        environmentUrl="./textures/hdri/hdri_1k.hdr"
        textureColorUrl='./textures/plastic/Plastic006_1K-JPG_Color.jpg'
        matcapTextureUrl='./textures/matcap/19.png'
        // toonGradientUrl='./textures/gradients/3.png'
        // textureColorUrl='./textures/color/glasses.svg'
        // textureColorUrl='./textures/color/polka-dots.svg'
        textureNormalUrl="./textures/plastic/Plastic006_1K-JPG_NormalDX.jpg"
        textureRoughnessUrl='./textures/plastic/Plastic006_1K-JPG_Roughness.jpg'
      />
    </>
  )
}

export default App
