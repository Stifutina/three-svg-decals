import './App.css'
import ThreeViewer from './components/ThreeViewer/ThreeViewer'

function App() {

  return (
    <>
      <ThreeViewer 
        modelUrl="./models/RO21.glb"
        environmentUrl="./textures/hdri/hdri_1k.hdr"
        textureColorUrl='./textures/color/color_map.svg'
        textureNormalUrl="./textures/fabric032/Fabric032_1K-JPG_NormalDX.jpg"
      />
    </>
  )
}

export default App
