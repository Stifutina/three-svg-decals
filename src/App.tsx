import './App.css'
import ThreeViewer from './components/ThreeViewer/ThreeViewer'

function App() {

  return (
    <>
      <ThreeViewer 
        modelUrl="./models/glasses.glb"
        environmentUrl="./textures/hdri/hdri_1k.hdr"
        textureColorUrl='./textures/plastic/Plastic006_1K-JPG_Color.jpg'
        textureNormalUrl="./textures/plastic/Plastic006_1K-JPG_NormalDX.jpg"
        textureRoughnessUrl='./textures/plastic/Plastic006_1K-JPG_Roughness.jpg'
      />
    </>
  )
}

export default App
