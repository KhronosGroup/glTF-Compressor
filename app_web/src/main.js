
import { GltfView, GltfState } from 'gltf-viewer-source';

import { gltfNode } from './../../source/gltf/node'; 

import { UIModel } from './logic/uimodel.js';
import { app } from './ui/ui.js';
import { Observable, Subject, from, merge } from 'rxjs';
import { mergeMap, filter, map, multicast, share } from 'rxjs/operators';
import { GltfModelPathProvider, fillEnvironmentWithPaths } from './model_path_provider.js';
import { ImageType } from "../../source/gltf/image_type.js";
import { ImageMimeType } from "../../source/gltf/image_mime_type.js";
import { GL } from "../../source/Renderer/webgl.js";
import * as zip from "@zip.js/zip.js";
import path from 'path';
import {GlbSerializer} from "../../source/ResourceLoader/glb_serializer.js";
import {getIsGlb, getContainingFolder} from "../../source/gltf/utils.js";
import { GEOMETRY_COMPRESSION_TYPE, GeometryQuantizationOptions, GeometryDracoOptions, GeometryMeshOptOptions, getComponentDataType, isComponentDataTypeNormalized } from './../../source/geometry_compressor.js';

export default async () => {
    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("webgl2", { alpha: false, antialias: true });
    const view = new GltfView(context);
    const resourceLoader = view.createResourceLoader();
    const state = view.createState();
    state.renderingParameters.useDirectionalLightsWithDisabledIBL = true;

    const pathProvider = new GltfModelPathProvider('assets/models/Models/model-index.json');
    await pathProvider.initialize();
    const environmentPaths = fillEnvironmentWithPaths({
        "footprint_court": "Footprint Court",
        "pisa": "Pisa",
        "doge2": "Doge's palace",
        "ennis": "Dining room",
        "field": "Field",
        "helipad": "Helipad Goldenhour",
        "papermill": "Papermill Ruins",
        "neutral": "Studio Neutral",
        "Cannon_Exterior": "Cannon Exterior",
        "Colorful_Studio": "Colorful Studio",
        "Wide_Street" : "Wide Street",
    }, "assets/environments/");

    const uiModel = new UIModel(app, pathProvider, environmentPaths);

    function resetMeshNodeTable()
    {
        if(document.getElementById("geometry_table"))
            document.getElementById("geometry_table").innerHTML = "";
    }

    function resetMeshNodeTree()
    {
        function setChecked(name, value){
            const e = document.getElementById(name);
            if(e !== undefined && e !== null)
                e.checked = value;
        }

        function resetNodeToTree (node) {
            // Set value
            setChecked('mesh_node_' + node.name, false);
            // recurse into children
            for(const j of node.children)
                resetNodeToTree(state.gltf.nodes[j]);
        }

        var root_name = 'mesh_node_Root';
        if(state.gltf){
            state.gltf.nodes.forEach((node) => resetNodeToTree(node) );
            root_name = state.gltf.scenes[state.sceneIndex].name === undefined ? root_name : 'mesh_node_' + state.gltf.scenes[state.sceneIndex].name;  
        }

        setChecked(root_name, false);
    }

    // whenever a new model is selected, load it and when complete pass the loaded gltf
    // into a stream back into the UI
    const gltfLoadedSubject = new Subject();
    const gltfLoadedMulticast = uiModel.model.pipe(
        mergeMap( (model) =>
        {
            resetMeshNodeTree();

            resetMeshNodeTable();

        	uiModel.goToLoadingState();

            // Workaround for errors in ktx lib after loading an asset with ktx2 files for the second time:
            resourceLoader.initKtxLib();

            return from(resourceLoader.loadGltf(model.mainFile, model.additionalFiles).then(gltf => {
                state.gltf = gltf;
                const defaultScene = state.gltf.scene;
                state.sceneIndex = defaultScene === undefined ? 0 : defaultScene;
                state.cameraIndex = undefined;

                if (state.gltf.scenes.length != 0) {
                    if (state.sceneIndex > state.gltf.scenes.length - 1) {
                        state.sceneIndex = 0;
                    }
                    const scene = state.gltf.scenes[state.sceneIndex];
                    scene.applyTransformHierarchy(state.gltf);
                    state.userCamera.aspectRatio = canvas.width / canvas.height;
                    state.userCamera.fitViewToScene(state.gltf, state.sceneIndex);

                    // Try to start as many animations as possible without generating conficts.
                    state.animationIndices = [];
                    for (let i = 0; i < gltf.animations.length; i++) {
                        if (!gltf.nonDisjointAnimations(state.animationIndices).includes(i)) {
                            state.animationIndices.push(i);
                        }
                    }
                    state.animationTimer.start();
                }

                // TODO: check if this is the best position
                state.gltf.fillPrimitiveList();

                uiModel.exitLoadingState();

                return state;
            }));
        }),
        multicast(gltfLoadedSubject)
    );

    // Disable all animations which are not disjoint to the current selection of animations.
    uiModel.disabledAnimations(uiModel.activeAnimations.pipe(map(animationIndices => state.gltf.nonDisjointAnimations(animationIndices))));

    const sceneChangedObservable = uiModel.scene.pipe(
        map(sceneIndex => {
            state.sceneIndex = sceneIndex;
            state.cameraIndex = undefined;
            const scene = state.gltf.scenes[state.sceneIndex];
            if (scene !== undefined)
            {
                scene.applyTransformHierarchy(state.gltf);
                state.userCamera.fitViewToScene(state.gltf, state.sceneIndex);
            }
        }),
        share()
    );

    const statisticsUpdateObservable = merge(sceneChangedObservable, gltfLoadedMulticast).pipe(map(() => view.gatherStatistics(state)));

    const texturestatisticsUpdateObservableTemp = merge(
        gltfLoadedMulticast,
        sceneChangedObservable
    );

    const texturestatisticsUpdateObservable = texturestatisticsUpdateObservableTemp.pipe(
        map( (_) => view.gatherTextureStatistics(state) )
    );

    const cameraExportChangedObservable = uiModel.cameraValuesExport.pipe( map(_ => {
        let camera = state.userCamera;
        if(state.cameraIndex !== undefined)
        {
            camera = state.gltf.cameras[state.cameraIndex];
        }
        const cameraDesc = camera.getDescription(state.gltf);
        return cameraDesc;
    }));

    const base64 = ( buffer ) => {
        if (typeof(buffer) === "string") return window.btoa( buffer );

        var binary = '';
        const bytes = new Uint8Array( buffer );
        const len = bytes.byteLength;
        for (var i = 0; i < len; i++) {
            binary += String.fromCharCode( bytes[ i ] );
        }
        
        return window.btoa( binary );
    };

    const downloadBlob = (filename, blob) => {
        const element = document.createElement('a');
        element.setAttribute('href', URL.createObjectURL(blob));
        element.setAttribute('download', 'file.zip');

        element.style.display = 'none';

        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    const downloadDataURL = (filename, dataURL) => {
        const element = document.createElement('a');
        element.setAttribute('href', dataURL);
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    cameraExportChangedObservable.subscribe(cameraDesc => {
        const gltf = JSON.stringify(cameraDesc, undefined, 4);
        const dataURL = 'data:text/plain;charset=utf-8,' +  encodeURIComponent(gltf);
        downloadDataURL("camera.gltf", dataURL);
    });
    
    uiModel.captureCanvas.subscribe( () => {
        view.renderFrame(state, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL();
        downloadDataURL("capture.png", dataURL);
    });

    // Only redraw glTF view upon user inputs, or when an animation is playing.
    let redraw = false;
    const listenForRedraw = stream => stream.subscribe(() => redraw = true);
    
    uiModel.scene.subscribe(scene => state.sceneIndex = scene !== -1 ? scene : undefined);
    listenForRedraw(uiModel.scene);

    uiModel.camera.subscribe(camera => state.cameraIndex = camera !== -1 ? camera : undefined);
    listenForRedraw(uiModel.camera);

    uiModel.variant.subscribe(variant => state.variant = variant);
    listenForRedraw(uiModel.variant);

    uiModel.tonemap.subscribe(tonemap => state.renderingParameters.toneMap = tonemap);
    listenForRedraw(uiModel.tonemap);

    uiModel.debugchannel.subscribe(debugchannel => state.renderingParameters.debugOutput = debugchannel);
    listenForRedraw(uiModel.debugchannel);

    uiModel.skinningEnabled.subscribe(skinningEnabled => state.renderingParameters.skinning = skinningEnabled);
    listenForRedraw(uiModel.skinningEnabled);

    uiModel.exposure.subscribe(exposure => state.renderingParameters.exposure = (1.0 / Math.pow(2.0, exposure)));
    listenForRedraw(uiModel.exposure);

    uiModel.morphingEnabled.subscribe(morphingEnabled => state.renderingParameters.morphing = morphingEnabled);
    listenForRedraw(uiModel.morphingEnabled);

    uiModel.clearcoatEnabled.subscribe(clearcoatEnabled => state.renderingParameters.enabledExtensions.KHR_materials_clearcoat = clearcoatEnabled);
    listenForRedraw(uiModel.clearcoatEnabled);

    uiModel.sheenEnabled.subscribe(sheenEnabled => state.renderingParameters.enabledExtensions.KHR_materials_sheen = sheenEnabled);
    listenForRedraw(uiModel.sheenEnabled);

    uiModel.transmissionEnabled.subscribe(transmissionEnabled => state.renderingParameters.enabledExtensions.KHR_materials_transmission = transmissionEnabled);
    listenForRedraw(uiModel.transmissionEnabled);

    uiModel.volumeEnabled.subscribe(volumeEnabled => state.renderingParameters.enabledExtensions.KHR_materials_volume = volumeEnabled);
    listenForRedraw(uiModel.volumeEnabled);

    uiModel.iorEnabled.subscribe(iorEnabled => state.renderingParameters.enabledExtensions.KHR_materials_ior = iorEnabled);
    listenForRedraw(uiModel.iorEnabled);

    uiModel.iridescenceEnabled.subscribe(iridescenceEnabled => state.renderingParameters.enabledExtensions.KHR_materials_iridescence = iridescenceEnabled);
    listenForRedraw(uiModel.specularEnabled);

    uiModel.anisotropyEnabled.subscribe(anisotropyEnabled => state.renderingParameters.enabledExtensions.KHR_materials_anisotropy = anisotropyEnabled);
    listenForRedraw(uiModel.iridescenceEnabled);

    uiModel.specularEnabled.subscribe(specularEnabled => state.renderingParameters.enabledExtensions.KHR_materials_specular = specularEnabled);
    listenForRedraw(uiModel.anisotropyEnabled);

    uiModel.emissiveStrengthEnabled.subscribe(enabled => state.renderingParameters.enabledExtensions.KHR_materials_emissive_strength = enabled);
    listenForRedraw(uiModel.emissiveStrengthEnabled);

    uiModel.iblEnabled.subscribe(iblEnabled => state.renderingParameters.useIBL = iblEnabled);
    listenForRedraw(uiModel.iblEnabled);

    uiModel.iblIntensity.subscribe(iblIntensity => state.renderingParameters.iblIntensity = Math.pow(10, iblIntensity));
    listenForRedraw(uiModel.iblIntensity);

    // GSV-KTX
    uiModel.texturesSelectionType.subscribe( texturesSelectionType => {
        for(let i=0; i<state.gltf.images.length; i++){
            if(state.gltf.images[i].mimeType === ImageMimeType.GLTEXTURE)
                continue;

            const type = state.gltf.images[i].imageType;
            document.getElementById('image-' + i).checked = false;
            if((texturesSelectionType === "All") || 
               (texturesSelectionType === "Color"     && type === ImageType.COLOR)    ||
               (texturesSelectionType === "Non-color" && type === ImageType.NONCOLOR) ||
               (texturesSelectionType === "Normal"    && type === ImageType.NORMAL)
            )
                document.getElementById('image-' + i).checked = true;
        }
        uiModel.updateEncodingKTX(texturesSelectionType);
        state.compressorParameters.compressionTextureEncoding = (texturesSelectionType === "Color") ? "ETC1S" : "UASTC";
    });

    uiModel.compressionGeometrySelectionType.subscribe( compressionGeometrySelectionType => {
        state.compressorParameters.compressionGeometryType = compressionGeometrySelectionType;
    });

    uiModel.compressionTextureSelectionType.subscribe( compressionTextureSelectionType => {
        state.compressorParameters.compressionTextureType = compressionTextureSelectionType;
    });
    
    uiModel.compressionTextureResolutionDownscale.subscribe( downscale => {
        state.compressorParameters.resolutionDownscale = downscale;
    });

    uiModel.compressionQualityJPEG.subscribe( compressionQualityJPEG => {
        state.compressorParameters.compressionQualityJPEG = compressionQualityJPEG;
    });
    uiModel.compressionQualityPNG.subscribe( compressionQualityPNG => {
        state.compressorParameters.compressionQualityPNG = compressionQualityPNG;
    });
    uiModel.compressionQualityWEBP.subscribe( compressionQualityWEBP => {
        state.compressorParameters.compressionQualityWEBP = compressionQualityWEBP;
    });

    uiModel.compressionUASTC_Rdo_Algorithm.subscribe( compressionUASTC_Rdo_Algorithm => {
        state.compressorParameters.compressionUASTC_Rdo_Algorithm = compressionUASTC_Rdo_Algorithm;
    });

    uiModel.compressionQuantizationPositionType.subscribe( compressionQuantizationPositionType => {
        state.compressorParameters.compressionQuantizationPositionType = compressionQuantizationPositionType;
    });

    uiModel.compressionQuantizationNormalType.subscribe( compressionQuantizationNormalType => {
        state.compressorParameters.compressionQuantizationNormalType = compressionQuantizationNormalType;
    });

    uiModel.compressionQuantizationTangentType.subscribe( compressionQuantizationTangentType => {
        state.compressorParameters.compressionQuantizationTangentType = compressionQuantizationTangentType;
    });

    uiModel.compressionQuantizationTexCoords0Type.subscribe( compressionQuantizationTexCoords0Type => {
        state.compressorParameters.compressionQuantizationTexCoords0Type = compressionQuantizationTexCoords0Type;
    });

    uiModel.compressionQuantizationTexCoords1Type.subscribe( compressionQuantizationTexCoords1Type => {
        state.compressorParameters.compressionQuantizationTexCoords1Type = compressionQuantizationTexCoords1Type;
    });

    uiModel.compressionDracoEncodingMethod.subscribe( compressionDracoEncodingMethod => {
        state.compressorParameters.compressionDracoEncodingMethod = compressionDracoEncodingMethod;
    });

    uiModel.compressionSpeedDraco.subscribe( compressionSpeedDraco => {
        state.compressorParameters.compressionSpeedDraco = compressionSpeedDraco;
    });

    uiModel.decompressionSpeedDraco.subscribe( decompressionSpeedDraco => {
        state.compressorParameters.decompressionSpeedDraco = decompressionSpeedDraco;
    });

    uiModel.compressionDracoQuantizationPositionQuantBits.subscribe( compressionDracoQuantizationPositionQuantBits => {
        state.compressorParameters.compressionDracoQuantizationPositionQuantBits = compressionDracoQuantizationPositionQuantBits;
    });

    uiModel.compressionDracoQuantizationNormalQuantBits.subscribe( compressionDracoQuantizationNormalQuantBits => {
        state.compressorParameters.compressionDracoQuantizationNormalQuantBits = compressionDracoQuantizationNormalQuantBits;
    });

    uiModel.compressionDracoQuantizationColorQuantBits.subscribe( compressionDracoQuantizationColorQuantBits => {
        state.compressorParameters.compressionDracoQuantizationColorQuantBits = compressionDracoQuantizationColorQuantBits;
    });

    uiModel.compressionDracoQuantizationTexcoordQuantBits.subscribe( compressionDracoQuantizationTexcoordQuantBits => {
        state.compressorParameters.compressionDracoQuantizationTexcoordQuantBits = compressionDracoQuantizationTexcoordQuantBits;
    });

    uiModel.compressionDracoQuantizationGenericQuantBits.subscribe( compressionDracoQuantizationGenericQuantBits => {
        state.compressorParameters.compressionDracoQuantizationGenericQuantBits = compressionDracoQuantizationGenericQuantBits;
    });

    uiModel.compressionDracoQuantizationTangentQuantBits.subscribe( compressionDracoQuantizationTangentQuantBits => {
        state.compressorParameters.compressionDracoQuantizationTangentQuantBits = compressionDracoQuantizationTangentQuantBits;
    });

    uiModel.compressionDracoQuantizationWeightQuantBits.subscribe( compressionDracoQuantizationWeightQuantBits => {
        state.compressorParameters.compressionDracoQuantizationWeightQuantBits = compressionDracoQuantizationWeightQuantBits;
    });

    uiModel.compressionDracoQuantizationJointQuantBits.subscribe( compressionDracoQuantizationJointQuantBits => {
        state.compressorParameters.compressionDracoQuantizationJointQuantBits = compressionDracoQuantizationJointQuantBits;
    });

    uiModel.compressionMeshOptFilterMethod.subscribe( compressionMeshOptFilterMethod => {
        state.compressorParameters.compressionMeshOptFilterMethod = compressionMeshOptFilterMethod;
    });

    uiModel.compressionMeshOptFilterMode.subscribe( compressionMeshOptFilterMode => {
        state.compressorParameters.compressionMeshOptFilterMode = compressionMeshOptFilterMode;
    });

    uiModel.compressionMeshOptFilterQuantizationBits.subscribe( compressionMeshOptFilterQuantizationBits => {
        state.compressorParameters.compressionMeshOptFilterQuantizationBits = compressionMeshOptFilterQuantizationBits;
    });

    uiModel.positionFilter.subscribe( positionFilter => {
        console.log('positionFilter', positionFilter);
        state.compressorParameters.positionFilter = positionFilter;
    });
    uiModel.positionFilterMode.subscribe( positionFilterMode => {
        state.compressorParameters.positionFilterMode = positionFilterMode;
    });
    uiModel.positionFilterBits.subscribe( positionFilterBits => {
        state.compressorParameters.positionFilterBits = positionFilterBits;
    });

    uiModel.tangentFilter.subscribe( tangentFilter => {
        state.compressorParameters.tangentFilter = tangentFilter;
    });
    uiModel.tangentFilterMode.subscribe( tangentFilterMode => {
        state.compressorParameters.tangentFilterMode = tangentFilterMode;
    });
    uiModel.tangentFilterBits.subscribe( tangentFilterBits => {
        state.compressorParameters.tangentFilterBits = tangentFilterBits;
    });

    uiModel.normalFilter.subscribe( normalFilter => {
        state.compressorParameters.normalFilter = normalFilter;
    });
    uiModel.normalFilterMode.subscribe( normalFilterMode => {
        state.compressorParameters.normalFilterMode = normalFilterMode;
    });
    uiModel.normalFilterBits.subscribe( normalFilterBits => {
        state.compressorParameters.normalFilterBits = normalFilterBits;
    });

    uiModel.tex0Filter.subscribe( tex0Filter => {
        state.compressorParameters.tex0Filter = tex0Filter;
    });
    uiModel.tex0FilterMode.subscribe( tex0FilterMode => {
        state.compressorParameters.tex0FilterMode = tex0FilterMode;
    });
    uiModel.tex0FilterBits.subscribe( tex0FilterBits => {
        state.compressorParameters.tex0FilterBits = tex0FilterBits;
    });

    uiModel.tex1Filter.subscribe( tex1Filter => {
        state.compressorParameters.tex1Filter = tex1Filter;
    });
    uiModel.tex1FilterMode.subscribe( tex1FilterMode => {
        state.compressorParameters.tex1FilterMode = tex1FilterMode;
    });
    uiModel.tex1FilterBits.subscribe( tex1FilterBits => {
        state.compressorParameters.tex1FilterBits = tex1FilterBits;
    });

    uiModel.compressionMeshOptReorder.subscribe( compressionMeshOptReorder => {
        state.compressorParameters.compressionMeshOptReorder = compressionMeshOptReorder;
    });

    uiModel.compressionMOptQuantizationPosition.subscribe( compressionMOptQuantizationPosition => {
        state.compressorParameters.compressionMOptQuantizationPosition = compressionMOptQuantizationPosition;
    });

    uiModel.compressionMOptQuantizationNormal.subscribe( compressionMOptQuantizationNormal => {
        state.compressorParameters.compressionMOptQuantizationNormal = compressionMOptQuantizationNormal;
    });

    uiModel.compressionMOptQuantizationTangent.subscribe( compressionMOptQuantizationTangent => {
        state.compressorParameters.compressionMOptQuantizationTangent = compressionMOptQuantizationTangent;
    });

    uiModel.compressionMOptQuantizationTexCoords0.subscribe( compressionMOptQuantizationTexCoords0 => {
        state.compressorParameters.compressionMOptQuantizationTexCoords0 = compressionMOptQuantizationTexCoords0;
    });

    uiModel.compressionMOptQuantizationTexCoords1.subscribe( compressionMOptQuantizationTexCoords1 => {
        state.compressorParameters.compressionMOptQuantizationTexCoords1 = compressionMOptQuantizationTexCoords1;
    });

    uiModel.compressionTextureEncoding.subscribe( compressionTextureEncoding => {
        state.compressorParameters.compressionTextureEncoding = compressionTextureEncoding;
    });

    uiModel.compressionUASTC_Flags.subscribe( compressionUASTC_Flags => {
        state.compressorParameters.compressionUASTC_Flags = compressionUASTC_Flags;
    });

    uiModel.compressionUASTC_Rdo.subscribe( compressionUASTC_Rdo => {
        state.compressorParameters.compressionUASTC_Rdo = compressionUASTC_Rdo;
    });

    uiModel.compressionUASTC_Rdo_Level.subscribe( compressionUASTC_Rdo_Level => {
        state.compressorParameters.compressionUASTC_Rdo_Level = compressionUASTC_Rdo_Level;
    });

    uiModel.compressionUASTC_Rdo_QualityScalar.subscribe( compressionUASTC_Rdo_QualityScalar => {
        state.compressorParameters.compressionUASTC_Rdo_QualityScalar = compressionUASTC_Rdo_QualityScalar;
    });

    uiModel.compressionUASTC_Rdo_DictionarySize.subscribe( compressionUASTC_Rdo_DictionarySize => {
        state.compressorParameters.compressionUASTC_Rdo_DictionarySize = compressionUASTC_Rdo_DictionarySize;
    });

    uiModel.compressionUASTC_Rdo_MaxSmoothBlockErrorScale.subscribe( compressionUASTC_Rdo_MaxSmoothBlockErrorScale => {
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockErrorScale = compressionUASTC_Rdo_MaxSmoothBlockErrorScale;
    });

    uiModel.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation.subscribe( compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation => {
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation = compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation;
    });

    uiModel.compressionUASTC_Rdo_DonotFavorSimplerModes.subscribe( compressionUASTC_Rdo_DonotFavorSimplerModes => {
        state.compressorParameters.compressionUASTC_Rdo_DonotFavorSimplerModes = compressionUASTC_Rdo_DonotFavorSimplerModes;
    });

    uiModel.compressionETC1S_CompressionLevel.subscribe( compressionETC1S_CompressionLevel => {
        state.compressorParameters.compressionETC1S_CompressionLevel = compressionETC1S_CompressionLevel;
    });

    uiModel.compressionETC1S_QualityLevel.subscribe( compressionETC1S_QualityLevel => {
        state.compressorParameters.compressionETC1S_QualityLevel = compressionETC1S_QualityLevel;
    });

    uiModel.compressionETC1S_MaxEndPoints.subscribe( compressionETC1S_MaxEndPoints => {
        state.compressorParameters.compressionETC1S_MaxEndPoints = compressionETC1S_MaxEndPoints;
    });

    uiModel.compressionETC1S_EndpointRdoThreshold.subscribe( compressionETC1S_EndpointRdoThreshold => {
        state.compressorParameters.compressionETC1S_EndpointRdoThreshold = compressionETC1S_EndpointRdoThreshold;
    });

    uiModel.compressionETC1S_MaxSelectors.subscribe( compressionETC1S_MaxSelectors => {
        state.compressorParameters.compressionETC1S_MaxSelectors = compressionETC1S_MaxSelectors;
    });

    uiModel.compressionETC1S_SelectorRdoThreshold.subscribe( compressionETC1S_SelectorRdoThreshold => {
        state.compressorParameters.compressionETC1S_SelectorRdoThreshold = compressionETC1S_SelectorRdoThreshold;
    });

    uiModel.compressionETC1S_NoEndpointRdo.subscribe( compressionETC1S_NoEndpointRdo => {
        state.compressorParameters.compressionETC1S_NoEndpointRdo = compressionETC1S_NoEndpointRdo;
    });

    uiModel.compressionETC1S_NoSelectorRdo.subscribe( compressionETC1S_NoSelectorRdo => {
        state.compressorParameters.compressionETC1S_NoSelectorRdo = compressionETC1S_NoSelectorRdo;
    });

    uiModel.comparisonViewMode.subscribe( index => {

        if(state.compressorParameters.previewTextureIndex === index)
        {
            state.compressorParameters.previewMode = GltfState.CompressionComparison.PREVIEW_3D;
            state.compressorParameters.previewTextureIndex = -1;
            state.compressorParameters.previewTextureZoom = {left: 0, right: 1, bottom: 0, top: 1};
        }
        else
        {
            state.compressorParameters.previewMode = GltfState.CompressionComparison.PREVIEW_2D;
            state.compressorParameters.previewTextureIndex = index;
            state.compressorParameters.previewTextureZoom = {left: 0, right: 1, bottom: 0, top: 1};
        }

        uiModel.updateSlider(index, state.compressorParameters.previewMode);
    });
    listenForRedraw(uiModel.comparisonViewMode);

    // Set Highlight on selected meshes
    uiModel.selectedGeometry.subscribe( selectedMeshes => {
        for(const selectedMesh of selectedMeshes)
            state.gltf.meshes[selectedMesh[0]].setHighlight(selectedMesh[1]);
    });
    listenForRedraw(uiModel.selectedGeometry);

    // Enable Mesh Hightlighting
    uiModel.enableMeshHighlighting.subscribe( value => {
        state.compressorParameters.meshHighlighing = value;
    });
    listenForRedraw(uiModel.enableMeshHighlighting);

    // Compressed Preview Mode
    uiModel.compressedPreviewMode.subscribe( compressedPreviewMode => {
        state.compressorParameters.sliderPosition = compressedPreviewMode? 0.0 : 1.0;
        uiModel.updateImageSlider(state.compressorParameters.sliderPosition);
    });
    listenForRedraw(uiModel.compressedPreviewMode);
    // preview slider
    uiModel.previewImageSlider.subscribe( previewImageSlider => {
        state.compressorParameters.sliderPosition = previewImageSlider;        
    });
    listenForRedraw(uiModel.previewImageSlider);
    // Compress textures
    const compressSubject = new Subject();
    const compressChangedObservable = uiModel.compressGeometry.pipe( mergeMap(async _ => {

        // Geometry to be Compressed
        state.compressorParameters.selectedMeshes = [];
        for(let i=0; i<state.gltf.nodes.length; i++){
            const node = state.gltf.nodes[i];
            const name = node.name !== undefined ? node.name : "Node_" + i;
            if(node.mesh !== undefined && document.getElementById('mesh_node_' + name).checked)
                state.compressorParameters.selectedMeshes.push(i);
        }

        // Images to be Compressed
        state.compressorParameters.selectedImages = [];
        for(let i=0; i<state.gltf.images.length; i++)
            if(state.gltf.images[i].mimeType !== ImageMimeType.GLTEXTURE && document.getElementById('image-' + i).checked)
                state.compressorParameters.selectedImages.push(i);

        if(state.compressorParameters.selectedMeshes.length === 0 && state.compressorParameters.selectedImages.length === 0)
            return false;

        if(state.compressorParameters.selectedMeshes.length > 0){  
            
            // Update Compression Format
            for(let index = 0; index < state.compressorParameters.selectedMeshes.length; index++)
                state.gltf.meshes[state.gltf.nodes[state.compressorParameters.selectedMeshes[index]].mesh].compressionFormatAfter = state.compressorParameters.compressionGeometryType;

            let type = state.compressorParameters.compressionGeometryType;
            
            var compress_options;
            if(type === GEOMETRY_COMPRESSION_TYPE.QUANTIZATION){
                compress_options = new GeometryQuantizationOptions();
                compress_options.positionCompression = getComponentDataType(state.compressorParameters.compressionQuantizationPositionType);
                compress_options.positionCompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionQuantizationPositionType);
                compress_options.normalsCompression = getComponentDataType(state.compressorParameters.compressionQuantizationNormalType);
                compress_options.normalsCompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionQuantizationNormalType);
                compress_options.texcoord0Compression = getComponentDataType(state.compressorParameters.compressionQuantizationTexCoords0Type);
                compress_options.texcoord0CompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionQuantizationTexCoords0Type);
                compress_options.texcoord1Compression = getComponentDataType(state.compressorParameters.compressionQuantizationTexCoords1Type);
                compress_options.texcoord1CompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionQuantizationTexCoords1Type);
                compress_options.tangentsCompression = getComponentDataType(state.compressorParameters.compressionQuantizationTangentType);
                compress_options.tangentsCompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionQuantizationTangentType);
            }
            else if(type === GEOMETRY_COMPRESSION_TYPE.DRACO){
                compress_options = new GeometryDracoOptions();
                compress_options.encodingMethod = state.compressorParameters.compressionDracoEncodingMethod; 
                compress_options.compressionSpeed = state.compressorParameters.compressionSpeedDraco;
                compress_options.decompressionSpeed = state.compressorParameters.decompressionSpeedDraco;
                compress_options.positionCompressionQuantizationBits = state.compressorParameters.compressionDracoQuantizationPositionQuantBits;
                compress_options.normalCompressionQuantizationBits = state.compressorParameters.compressionDracoQuantizationNormalQuantBits;
                compress_options.colorCompressionQuantizationBits = state.compressorParameters.compressionDracoQuantizationColorQuantBits;
                compress_options.texcoordCompressionQuantizationBits = state.compressorParameters.compressionDracoQuantizationTexcoordQuantBits;
                compress_options.genericQuantizationBits = state.compressorParameters.compressionDracoQuantizationGenericQuantBits;
                compress_options.tangentQuantizationBits = state.compressorParameters.compressionDracoQuantizationTangentQuantBits;
                compress_options.weightQuantizationBits = state.compressorParameters.compressionDracoQuantizationWeightQuantBits;
                compress_options.jointQuantizationBits = state.compressorParameters.compressionDracoQuantizationJointQuantBits;
            }
            else if(type === GEOMETRY_COMPRESSION_TYPE.MESHOPT)
            {
                compress_options = new GeometryMeshOptOptions();
                compress_options.reorder = state.compressorParameters.compressionMeshOptReorder;
                compress_options.positionCompressionQuantizationBits = state.compressorParameters.compressionMeshOptQuantizationPositionQuantBits;
                compress_options.normalCompressionQuantizationBits = state.compressorParameters.compressionMeshOptQuantizationNormalQuantBits;
                compress_options.colorCompressionQuantizationBits = state.compressorParameters.compressionMeshOptQuantizationColorQuantBits;
                compress_options.texcoordCompressionQuantizationBits = state.compressorParameters.compressionMeshOptQuantizationTexcoordQuantBits;
                compress_options.compressionMOptQuantizationPosition = state.compressorParameters.compressionMOptQuantizationPosition;
                compress_options.compressionMOptQuantizationNormal = state.compressorParameters.compressionMOptQuantizationNormal;
                compress_options.compressionMOptQuantizationTangent = state.compressorParameters.compressionMOptQuantizationTangent;
                compress_options.compressionMOptQuantizationTexCoords0 = state.compressorParameters.compressionMOptQuantizationTexCoords0;
                compress_options.compressionMOptQuantizationTexCoords1 = state.compressorParameters.compressionMOptQuantizationTexCoords1;
                compress_options.positionCompression = getComponentDataType(state.compressorParameters.compressionMOptQuantizationPosition);
                compress_options.positionCompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionMOptQuantizationPosition);
                compress_options.positionFilter = state.compressorParameters.positionFilter;
                compress_options.positionFilterMode = state.compressorParameters.positionFilterMode;
                compress_options.positionFilterBits = state.compressorParameters.positionFilterBits;
                compress_options.normalsCompression = getComponentDataType(state.compressorParameters.compressionMOptQuantizationNormal);
                compress_options.normalsCompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionMOptQuantizationNormal);
                compress_options.normalFilter = state.compressorParameters.normalFilter;
                compress_options.normalFilterMode = state.compressorParameters.normalFilterMode;
                compress_options.normalFilterBits = state.compressorParameters.normalFilterBits;
                compress_options.tangentCompression = getComponentDataType(state.compressorParameters.compressionMOptQuantizationTangent);
                compress_options.tangentCompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionMOptQuantizationTangent);
                compress_options.tangentFilter = state.compressorParameters.tangentFilter;
                compress_options.tangentFilterMode = state.compressorParameters.tangentFilterMode;
                compress_options.tangentFilterBits = state.compressorParameters.tangentFilterBits;
                compress_options.tangentFilter = state.compressorParameters.tangentFilter;
                compress_options.texcoord0Compression = getComponentDataType(state.compressorParameters.compressionMOptQuantizationTexCoords0);
                compress_options.texcoord0CompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionMOptQuantizationTexCoords0);
                compress_options.tex0Filter = state.compressorParameters.tex0Filter;
                compress_options.tex0FilterMode = state.compressorParameters.tex0FilterMode;
                compress_options.tex0FilterBits = state.compressorParameters.tex0FilterBits;
                compress_options.texcoord1Compression = getComponentDataType(state.compressorParameters.compressionMOptQuantizationTexCoords1);
                compress_options.texcoord1CompressionNormalized = isComponentDataTypeNormalized(state.compressorParameters.compressionMOptQuantizationTexCoords1);
                compress_options.tex1Filter = state.compressorParameters.tex1Filter;
                compress_options.tex1FilterMode = state.compressorParameters.tex1FilterMode;
                compress_options.tex1FilterBits = state.compressorParameters.tex1FilterBits;
            } else {
                compress_options = new GeometryQuantizationOptions();
                type = GEOMETRY_COMPRESSION_TYPE.QUANTIZATION;
                compress_options.positionCompression = getComponentDataType('FLOAT');
                compress_options.normalsCompression = getComponentDataType('FLOAT');
                compress_options.texcoord0Compression = getComponentDataType('FLOAT');
                compress_options.texcoord1Compression = getComponentDataType('FLOAT');
                compress_options.tangentsCompression = getComponentDataType('FLOAT');
                compress_options.positionCompressionNormalized = false;
                compress_options.normalsCompressionNormalized = false;
                compress_options.texcoord0CompressionNormalized = false;
                compress_options.texcoord1CompressionNormalized = false;
                compress_options.tangentsCompressionNormalized = false;
            }
            console.log('compress_options', compress_options);

            state.gltf.compressionVersion++;
            // Compress all selected nodes
            const meshNodeMap = new Map();
            state.compressorParameters.selectedMeshes.forEach(i => {meshNodeMap.set(state.gltf.nodes[i].mesh, i);}); 
            // find the nodes that have the meshes in order to be updated
            uiModel.updateCompressionButton(0, state.compressorParameters.selectedMeshes.length, "Geometry");
            for(let index of meshNodeMap.values())
            {
                state.gltf.nodes[index].compressGeometry(type, compress_options, state.gltf);
                uiModel.updateCompressionButton(index+1, state.compressorParameters.selectedMeshes.length, "Geometry");
            }
            //state.gltf.nodes.forEach((n,i, arr) => {arr[i].a1 = i;}); 
            state.compressorParameters.selectedMeshes.forEach(i => {
                const nodeID = meshNodeMap.get(state.gltf.nodes[i].mesh);
                if(nodeID !== i)
                {
                    const target = state.gltf.nodes[i];
                    const origin = state.gltf.nodes[nodeID];
                                    
                    // create a compression node
                    const node = new gltfNode();
                    node.isCompressedHelperNode = true;
                    node.compressedMesh = origin.compressedNode.compressedMesh;
                    node.compressedMesh.isCompressed = true;
                    node.matrix = origin.compressedNode.matrix;
                    node.rotation = new Float32Array(origin.compressedNode.rotation);
                    node.scale = new Float32Array(origin.compressedNode.scale);
                    node.translation = new Float32Array(origin.compressedNode.translation);
                    node.name = origin.compressedNode.name;

                    target.compressedNode = node;
                    target.children.push(state.gltf.nodes.length);
                    state.gltf.nodes.push(node);
                }
            });
            state.compressorParameters.processedMeshes = state.compressorParameters.processedMeshes.concat(state.compressorParameters.selectedMeshes.filter((item) => state.compressorParameters.processedMeshes.indexOf(item) < 0));

            // force to update
            view.renderer.preparedScene = null;
        }

        if(state.compressorParameters.selectedImages.length > 0)
        {    
            // Set resolution downscale scale
            const scale  = parseInt(state.compressorParameters.resolutionDownscale.replace(/\D/g, ""));
            const compressed_images = [];
            let targetQuality;
            let targetMimeType;
        
            const options = {};
            if(state.compressorParameters.compressionTextureType === "KTX2"){
                targetMimeType = ImageMimeType.KTX2;
                const targetKTX2_encoding = state.compressorParameters.compressionTextureEncoding;
                const targetKTX2_UASTC_flags = state.compressorParameters.compressionUASTC_Flags;
                const targetKTX2_UASTC_RDO = state.compressorParameters.compressionUASTC_Rdo;
                const targetKTX2_UASTC_RDO_algorithm = state.compressorParameters.compressionUASTC_Rdo_Algorithm;
                const targetKTX2_UASTC_RDO_level = state.compressorParameters.compressionUASTC_Rdo_Level; 
                const targetKTX2_UASTC_RDO_quality = state.compressorParameters.compressionUASTC_Rdo_QualityScalar;
                const targetKTX2_UASTC_RDO_dictionarySize = state.compressorParameters.compressionUASTC_Rdo_DictionarySize;
                const targetKTX2_UASTC_RDO_maxSmoothBlockErrorScale = state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockErrorScale;
                const targetKTX2_UASTC_RDO_maxSmoothBlockStandardDeviation = state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation;
                const targetKTX2_UASTC_RDO_donotFavorSimplerModes = state.compressorParameters.compressionUASTC_Rdo_DonotFavorSimplerModes;

                const targetKTX2_ETC1S_compressionLevel = state.compressorParameters.compressionETC1S_CompressionLevel;
                const targetKTX2_ETC1S_qualityLevel = state.compressorParameters.compressionETC1S_QualityLevel;
                const targetKTX2_ETC1S_maxEndPoints = state.compressorParameters.compressionETC1S_MaxEndPoints;
                const targetKTX2_ETC1S_endpointRdoThreshold = state.compressorParameters.compressionETC1S_EndpointRdoThreshold;
                const targetKTX2_ETC1S_maxSelectors = state.compressorParameters.compressionETC1S_MaxSelectors;
                const targetKTX2_ETC1S_SelectorRdoThreshold = state.compressorParameters.compressionETC1S_SelectorRdoThreshold;
                const targetKTX2_ETC1S_normalMap = false;
                const targetKTX2_ETC1S_noEndpointRdo = state.compressorParameters.compressionETC1S_NoEndpointRdo;
                const targetKTX2_ETC1S_noSelectorRdo = state.compressorParameters.compressionETC1S_NoSelectorRdo;

                const libktx = state.gltf.ktxEncoder.libktx;
                const basisu_options = new libktx.ktxBasisParams();
                basisu_options.uastc = targetKTX2_encoding === 'UASTC';
                basisu_options.noSSE = true;
                basisu_options.verbose = false;
                basisu_options.compressionLevel = targetKTX2_ETC1S_compressionLevel;
                basisu_options.qualityLevel = targetKTX2_ETC1S_qualityLevel;
                basisu_options.maxEndpoints = targetKTX2_ETC1S_maxEndPoints;
                basisu_options.endpointRDOThreshold = targetKTX2_ETC1S_endpointRdoThreshold;
                basisu_options.maxSelectors = targetKTX2_ETC1S_maxSelectors;
                basisu_options.selectorRDOThreshold = targetKTX2_ETC1S_SelectorRdoThreshold;
                basisu_options.normalMap = targetKTX2_ETC1S_normalMap;
                basisu_options.preSwizzle = false;
                basisu_options.noEndpointRDO = targetKTX2_ETC1S_noEndpointRdo;
                basisu_options.noSelectorRDO = targetKTX2_ETC1S_noSelectorRdo;

                basisu_options.uastcFlags = state.gltf.ktxEncoder.stringToUastcFlags(targetKTX2_UASTC_flags);
                basisu_options.uastcRDO = targetKTX2_UASTC_RDO;
                basisu_options.uastcRDOQualityScalar = targetKTX2_UASTC_RDO_quality;
                basisu_options.uastcRDODictSize = targetKTX2_UASTC_RDO_dictionarySize;
                basisu_options.uastcRDOMaxSmoothBlockErrorScale = targetKTX2_UASTC_RDO_maxSmoothBlockErrorScale;
                basisu_options.uastcRDOMaxSmoothBlockStdDev = targetKTX2_UASTC_RDO_maxSmoothBlockStandardDeviation;
                basisu_options.uastcRDODontFavorSimplerModes = targetKTX2_UASTC_RDO_donotFavorSimplerModes;
                
                if (basisu_options.uastc && targetKTX2_UASTC_RDO) {
                    options.supercmp_scheme = state.gltf.ktxEncoder.stringToSupercmpScheme(targetKTX2_UASTC_RDO_algorithm);
                    options.compression_level = targetKTX2_UASTC_RDO_level;
                }

                options.basisu_options = basisu_options;
            }
            else if(state.compressorParameters.compressionTextureType === "JPEG"){
                targetMimeType = ImageMimeType.JPEG;
                options.quality = state.compressorParameters.compressionQualityJPEG;
            }
            else if(state.compressorParameters.compressionTextureType === "PNG"){
                targetMimeType = ImageMimeType.PNG;
                options.quality = state.compressorParameters.compressionQualityPNG;
            }
            else if(state.compressorParameters.compressionTextureType === "WEBP"){
                targetMimeType = ImageMimeType.WEBP;
                options.quality = state.compressorParameters.compressionQualityWEBP;
            }

            uiModel.updateCompressionButton(0, state.compressorParameters.selectedImages.length, "Texture");
            
            // Free up the thread for 10ms in order to allow the UI to be updated
            const small_delay = new Promise((res) => setTimeout(() => res("small_delay"), 10));
            await small_delay;

            for(let index = 0; index < state.compressorParameters.selectedImages.length; index++)
            {
                const i = state.compressorParameters.selectedImages[index];
                const width = state.gltf.images[i].image.width;
                const height = state.gltf.images[i].image.height;
                
                const scaled_width  = scale > 1? Math.max(width/scale, 1) : width;
                const scaled_height = scale > 1? Math.max(height/scale, 1) : height;

                await state.gltf.images[i].compressImage(targetMimeType, scaled_width, scaled_height, options, state.gltf, () => uiModel.updateCompressionButton(index+1, state.compressorParameters.selectedImages.length, "Texture"));
            }

            state.compressorParameters.processedImages = state.compressorParameters.processedImages.concat(state.compressorParameters.selectedImages.filter((item) => state.compressorParameters.processedImages.indexOf(item) < 0));
        }

        return true;
    }), multicast(compressSubject));

    compressChangedObservable.subscribe(async compressDesc => {
        await compressDesc;
        console.warn(
            state.compressorParameters.selectedMeshes.length > 0 || state.compressorParameters.selectedImages.length > 0 ? 
                "Compression Complete" : "Please select any geometry or texture in order to proceed");
        redraw = true;
    });
    //listenForRedraw(compressChangedObservable);

    const compressionStatisticsUpdateObservableTemp = merge(
        compressChangedObservable,
    );

    const compressionStatisticsUpdateObservable = compressionStatisticsUpdateObservableTemp.pipe(
        map( (_) => view.gatherCompressionStatistics(state) )
    );

    uiModel.updateCompressionStatistics(compressionStatisticsUpdateObservable);    

    const gltfExportChangedObservable = uiModel.gltfFilesExport.pipe( map(_ => {
        
        const gltf = state.gltf;
        const og_gltf = gltf.og_gltf;
        const gltfJSON = {...gltf.originalJSON}; // no need for deeper cloning
        const toExt = (type) => type == ImageMimeType.JPEG? ".jpg" : type == ImageMimeType.PNG? ".png" : type == ImageMimeType.WEBP? ".webp" : ".ktx2";
        const align4Bytes = (num) => 4 * Math.floor((num - 1) / 4) + 4;
        const gltfJSONNew = {...gltf.originalJSON}; // no need for deeper cloning

        gltfJSONNew.images = [];
        gltfJSONNew.bufferViews = [];
        gltfJSONNew.buffers = [];
        gltfJSONNew.extensionsRequired = gltfJSON.extensionsRequired || [];
        gltfJSONNew.extensionsUsed = gltfJSON.extensionsUsed || [];

        // delete unsused meshes, accessors, bufferviews and buffers
        const meshes = Array.from({length: gltfJSONNew.meshes.length}, () => null);
        // store the final nodes
        gltfJSONNew.nodes = gltf.nodes.map(node => {
            const ret = {};

            if (node.camera !== undefined) ret.camera = node.camera;
            if (node.children !== undefined) ret.children = node.children;
            if (node.skin !== undefined) ret.skin = node.skin;
            if (node.matrix !== undefined) ret.matrix = Array.from(node.matrix);
            if (node.rotation !== undefined) ret.rotation = Array.from(node.rotation);
            if (node.scale !== undefined) ret.scale = Array.from(node.scale);
            if (node.translation !== undefined) ret.translation = Array.from(node.translation);
            if (node.weights !== undefined) ret.weights = Array.from(node.weights);
            if (node.name !== undefined) ret.name = node.name;
            if (node.extensions !== undefined) ret.extensions = node.extensions;
            if (node.extras !== undefined) ret.extras = node.extras;
            
            if (!node.compressedNode && node.mesh !== undefined) { 
                ret.mesh = node.mesh;
                meshes[node.mesh] = gltf.meshes[node.mesh];
            } else if (node.compressedMesh) {
                ret.mesh = node.compressedMesh.original_mesh;
                meshes[node.compressedMesh.original_mesh] = gltf.meshes[node.compressedMesh.mesh];
            }
            
            return ret;
        });

        const mem_buffers = [];
        const bufferViews = [];
        const uri_images = [];

        og_gltf.buffers.forEach((buffer) => {
            mem_buffers.push({...buffer, byteLength: 0, data: new Uint8Array(), embedded: (buffer.uri || "").startsWith("data:")});
        });

        const concat = (a, b) => {
            const c = new Uint8Array(align4Bytes(a.byteLength) + align4Bytes(b.byteLength));
            c.set(new Uint8Array(a));
            c.set(new Uint8Array(b), align4Bytes(a.byteLength));
            return new Uint8Array(c);
        };

        const bufferViewDict = [];
        let usesQuantization = false;
        let usesMeshopt = false;
        let usesDraco = false;
        const isQuantizedCb = (attribute, accessor) => {
            const ct = accessor.componentType;
            if ('POSITION' == attribute) 
                return (ct == GL.BYTE || ct == GL.UNSIGNED_BYTE || ct == GL.SHORT || ct == GL.UNSIGNED_SHORT);
            else if ('NORMAL' == attribute || 'TANGENT' == attribute) 
                return ((ct == GL.BYTE || ct == GL.SHORT) && accessor.normalized);
            else if ('TEXCOORD_0' == attribute || 'TEXCOORD_1' == attribute) 
                return (ct != GL.FLOAT && !accessor.normalized);
        };

        const containing_folder = getContainingFolder(gltf.path);
        gltf.images.filter(img => img.mimeType !== ImageMimeType.GLTEXTURE).forEach((image) => {
            const image_new = {};
            if (image.uri !== undefined) {
                const embedded = image.uri.startsWith("data:");
                const filename = (!embedded) ? image.uri.replace(containing_folder, "").replace(path.extname(image.uri), "") : "data:";
                const filename_ext = (!embedded) ? toExt(image.compressedMimeType) : image.compressedMimeType + ";base64," + base64(image.compressedImageTypedArrayBuffer);
                const data = (!embedded) ? ((image.originalImageTypedArrayBuffer) ? image.originalImageTypedArrayBuffer : image.compressedImageTypedArrayBuffer) : undefined;
                image_new.uri = filename + filename_ext;
                image_new.mimeType = image.compressedMimeType;
                uri_images.push({...image_new, data: data});
            } else {
                const bufferView = gltf.bufferViews[image.bufferView];
                const og_bufferView = bufferView;
                const mem_buffer = mem_buffers[og_bufferView.buffer];
                image_new.bufferView = bufferViews.length;
                image_new.mimeType = image.compressedMimeType;
                image_new.name = image.name;
                bufferViews.push({ buffer: og_bufferView.buffer, byteOffset: mem_buffer.byteLength, byteLength: image.compressedImageTypedArrayBuffer.byteLength })
                mem_buffer.data = concat(mem_buffer.data, image.compressedImageTypedArrayBuffer);
                mem_buffer.byteLength = mem_buffer.data.byteLength;
            }
            gltfJSONNew.images.push(image_new);
        });
        // Add KTX/WEBP required extension objects to JSON
        gltfJSONNew.images.forEach((image, index) => {
            const isWebP = ImageMimeType.WEBP === image.mimeType;
            const isKTX = ImageMimeType.KTX2 === image.mimeType;
            if (!isWebP && !isKTX) return;
            gltfJSONNew.textures.forEach((texture) => {
                if(texture.source !== index) return;
                texture.extensions = (isWebP) 
                    ? { EXT_texture_webp:   { source: texture.source } }
                    : { KHR_texture_basisu: { source: texture.source } };
                texture.source = undefined;
            });
        });

        meshes.forEach((mesh, index) => {
            const og_mesh = (mesh.original_mesh === undefined) ? mesh : gltf.meshes[mesh.original_mesh];
            const out_mesh = gltfJSONNew.meshes[index];
            mesh.primitives.forEach((prim, prim_index) => {
                const og_prim = og_mesh.primitives[prim_index];
                const og_accessor = og_gltf.accessors[og_prim.indices];
                const og_bufferView = og_gltf.bufferViews[og_accessor.bufferView];

                if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) {
                    const draco = prim.extensions.KHR_draco_mesh_compression;
                    const accessor = gltf.accessors[prim.indices];
                    const bufferView = gltf.bufferViews[draco.bufferView];
                    const buffer = gltf.buffers[bufferView.buffer];
                    const out_prim = out_mesh.primitives[prim_index];
                    const out_accessor = gltfJSONNew.accessors[og_prim.indices];
                    usesDraco = true;

                    out_prim.indices = og_prim.indices;
                    out_prim.material = og_prim.material;
                    out_prim.mode = og_prim.mode;   
                    out_prim.extensions = {
                        KHR_draco_mesh_compression: {
                            attributes: draco.attributes,
                            bufferView: bufferViews.length
                        }
                    };
                    out_accessor.bufferView = undefined;

                    Object.entries(prim.attributes).forEach(([key, value]) => {
                        const og_attribute = og_prim.attributes[key];
                        const attribute = prim.attributes[key];
                        const accessor = gltf.accessors[attribute];
                        const out_accessor = gltfJSONNew.accessors[og_attribute];

                        out_accessor.bufferView = undefined;
                        out_accessor.count = accessor.count;
                        out_accessor.byteOffset = undefined;
                    });

                    const mem_buffer = mem_buffers[og_bufferView.buffer];
                    bufferViews.push({ buffer: og_bufferView.buffer, byteOffset: mem_buffer.byteLength, byteLength: buffer.buffer.byteLength })
                    
                    mem_buffer.data = concat(mem_buffer.data, buffer.buffer);
                    mem_buffer.byteLength = mem_buffer.data.byteLength;
                } else {
                    const accessor = gltf.accessors[prim.indices];
                    const bufferView = gltf.bufferViews[accessor.bufferView];
                    const isMoptCompressed = bufferView.extensions && bufferView.extensions.EXT_meshopt_compression;
                    const buffer = (isMoptCompressed) ? gltf.buffers[bufferView.extensions.EXT_meshopt_compression.buffer] : gltf.buffers[bufferView.buffer];
                    const out_prim = out_mesh.primitives[prim_index];
                    const out_accessor = gltfJSONNew.accessors[og_prim.indices];
                    const mem_buffer_index = (og_bufferView.buffer < og_gltf.buffers.length) ? og_bufferView.buffer : 0;
                    const mem_buffer = mem_buffers[mem_buffer_index];
                    
                    const componentSize = accessor.getComponentSize(accessor.componentType);
                    const componentCount = accessor.getComponentCount(accessor.type);
                    const byteOffset = accessor.byteOffset + bufferView.byteOffset;
                    let stride = bufferView.byteStride !== 0 ? bufferView.byteStride : componentCount * componentSize;
                    out_prim.indices = og_prim.indices;
                    out_prim.material = og_prim.material;
                    out_prim.extensions = undefined; // clean any pre existing extensions (e.g. DRACO)
                    const out_bufferView = {
                        buffer: mem_buffer_index,
                        byteOffset: mem_buffer.byteLength,
                        byteLength: accessor.count * stride,
                        target: og_bufferView.target
                    };
                    if (isMoptCompressed) {
                        usesMeshopt = true;
                        // Switch back to old values (A compliant loader should disregard those)
                        out_bufferView.byteOffset = og_bufferView.byteOffset;
                        out_bufferView.buffer = og_gltf.buffers.length;
                        out_bufferView.extensions = {
                            EXT_meshopt_compression: {
                                buffer: mem_buffer_index,
                                byteOffset: mem_buffer.byteLength,
                                byteLength: bufferView.extensions.EXT_meshopt_compression.byteLength,
                                byteStride: bufferView.byteStride,
                                mode: bufferView.extensions.EXT_meshopt_compression.mode,
                                filter: bufferView.extensions.EXT_meshopt_compression.filter,
                                count: bufferView.extensions.EXT_meshopt_compression.count
                            }
                        }   
                    }

                    out_accessor.bufferView = bufferViews.length;
                    out_accessor.byteOffset = undefined;
                    bufferViewDict[accessor.bufferView] = bufferViews.length;
                    bufferViews.push(out_bufferView);
                    // Handle the case where the original is DRACO encoded
                    let index_buffer = buffer.buffer;
                    if (ArrayBuffer.isView(buffer.buffer) && !isMoptCompressed) {
                        if (accessor.componentType == GL.UNSIGNED_INT) index_buffer =  (new Uint32Array(buffer.buffer)).buffer;
                        if (accessor.componentType == GL.UNSIGNED_SHORT) index_buffer =  (new Uint16Array(buffer.buffer)).buffer;
                        if (accessor.componentType == GL.UNSIGNED_BYTE) index_buffer =  (new Uint8Array(buffer.buffer)).buffer;
                    }
                    const dataLength = (isMoptCompressed) ? bufferView.extensions.EXT_meshopt_compression.byteLength : accessor.count * stride;
                    mem_buffer.data = concat(mem_buffer.data, index_buffer.slice(byteOffset, byteOffset + dataLength));
                    mem_buffer.byteLength = mem_buffer.data.byteLength;
                    Object.entries(prim.attributes).forEach(([key, value]) => {
                        const attribute = prim.attributes[key];
                        const og_attribute = og_prim.attributes[key];
                        const og_accessor = og_gltf.accessors[og_attribute];
                        const og_bufferView = og_gltf.bufferViews[og_accessor.bufferView];
                        const accessor = gltf.accessors[attribute];
                        const bufferView = gltf.bufferViews[accessor.bufferView];
                        const isMoptCompressed = bufferView.extensions && bufferView.extensions.EXT_meshopt_compression;
                        const isQuantized = isQuantizedCb(key, accessor);
                        const buffer = (isMoptCompressed) ? gltf.buffers[bufferView.extensions.EXT_meshopt_compression.buffer] : gltf.buffers[bufferView.buffer];
                        const out_accessor = gltfJSONNew.accessors[og_attribute];

                        const componentSize = accessor.getComponentSize(accessor.componentType);
                        const componentCount = accessor.getComponentCount(accessor.type);
                        const byteOffset = accessor.byteOffset + bufferView.byteOffset;
                        let stride = bufferView.byteStride !== 0 ? bufferView.byteStride : componentCount * componentSize;

                        const out_bufferView = {
                            buffer: mem_buffer_index,
                            byteOffset: mem_buffer.byteLength,
                            byteLength: accessor.count * stride,
                            target: og_bufferView.target
                        };
                        if (isMoptCompressed) {
                            // Switch back to old values (A compliant loader should disregard those)
                            out_bufferView.byteOffset = og_bufferView.byteOffset;
                            out_bufferView.buffer = og_gltf.buffers.length;
                            out_bufferView.extensions = {
                                EXT_meshopt_compression: {
                                    buffer: mem_buffer_index,
                                    byteOffset: mem_buffer.byteLength,
                                    byteLength: bufferView.extensions.EXT_meshopt_compression.byteLength,
                                    byteStride: bufferView.byteStride,
                                    mode: bufferView.extensions.EXT_meshopt_compression.mode,
                                    filter: bufferView.extensions.EXT_meshopt_compression.filter,
                                    count: bufferView.extensions.EXT_meshopt_compression.count
                                }
                            }   
                        } else if (isQuantized) {
                            usesQuantization = true;
                            out_bufferView.buffer = mem_buffer_index;
                            out_bufferView.byteOffset = mem_buffer.byteLength;
                            out_bufferView.byteStride = bufferView.byteStride;
                            out_accessor.normalized = accessor.normalized;
                            out_accessor.componentType = accessor.componentType;
                            out_accessor.max = accessor.max;
                            out_accessor.min = accessor.min;
                        }
                        out_accessor.bufferView = bufferViews.length;
                        out_accessor.byteOffset = undefined;
                        bufferViewDict[accessor.bufferView] = bufferViews.length;
                        bufferViews.push(out_bufferView);
                        const dataLength = (isMoptCompressed) ? bufferView.extensions.EXT_meshopt_compression.byteLength : accessor.count * stride;
                        mem_buffer.data = concat(mem_buffer.data, buffer.buffer.slice(byteOffset, byteOffset + dataLength));
                        mem_buffer.byteLength = mem_buffer.data.byteLength;
                    });
                }
            });
        });

        if (gltfJSONNew.animations) {
            const animBufferViews = [];
            gltfJSONNew.animations.forEach((animation) => {
                animation.samplers.forEach((sampler) => {
                    const i_accessor = gltf.accessors[sampler.input];
                    const i_bufferView = gltf.bufferViews[i_accessor.bufferView];
                    const o_accessor = gltf.accessors[sampler.output];
                    const o_bufferView = gltf.bufferViews[o_accessor.bufferView];
                    
                    animBufferViews[i_accessor.bufferView] = i_bufferView;
                    animBufferViews[o_accessor.bufferView] = o_bufferView;
                    animBufferViews[i_accessor.bufferView].accessors = [];
                    animBufferViews[o_accessor.bufferView].accessors = [];
                });
            });

            gltfJSONNew.animations.forEach((animation) => {
                animation.samplers.forEach((sampler) => {
                    const i_accessor = gltf.accessors[sampler.input];
                    const o_accessor = gltf.accessors[sampler.output];
                    
                    animBufferViews[i_accessor.bufferView].accessors.push(gltfJSONNew.accessors[sampler.input]);
                    animBufferViews[o_accessor.bufferView].accessors.push(gltfJSONNew.accessors[sampler.output]);
                });
            });
            animBufferViews.forEach((bufferView) => {
                const buffer = gltf.buffers[bufferView.buffer];
                const mem_buffer = mem_buffers[bufferView.buffer];
                const out_bufferView = {
                    buffer: bufferView.buffer,
                    byteOffset: mem_buffer.byteLength,
                    byteLength: bufferView.byteLength,
                    target: bufferView.target
                };
                bufferView.accessors.forEach((accessor) => {
                    accessor.bufferView = bufferViews.length;
                });
                    
                bufferViews.push(out_bufferView);
                mem_buffer.data = concat(mem_buffer.data, buffer.buffer.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength));
                mem_buffer.byteLength = mem_buffer.data.byteLength;
            });
        }

        if (gltfJSONNew.skins) {
            const skinBufferViews = [];
            
            gltfJSONNew.skins.forEach((skin) => {
                if (!skin.inverseBindMatrices) return;
                const accessor = gltf.accessors[skin.inverseBindMatrices];
                const bufferView = gltf.bufferViews[accessor.bufferView];
                skinBufferViews[accessor.bufferView] = bufferView;
                skinBufferViews[accessor.bufferView].accessors = [];
            });
            gltfJSONNew.skins.forEach((skin) => {
                if (!skin.inverseBindMatrices) return;
                const accessor = gltf.accessors[skin.inverseBindMatrices];
                skinBufferViews[accessor.bufferView].accessors.push(gltfJSONNew.accessors[skin.inverseBindMatrices]);
            });
            skinBufferViews.forEach((bufferView) => {
                const buffer = gltf.buffers[bufferView.buffer];
                const mem_buffer = mem_buffers[bufferView.buffer];
                const out_bufferView = {
                    buffer: bufferView.buffer,
                    byteOffset: mem_buffer.byteLength,
                    byteLength: bufferView.byteLength,
                    target: bufferView.target
                };
                bufferView.accessors.forEach((accessor) => {
                    accessor.bufferView = bufferViews.length;
                });
                    
                bufferViews.push(out_bufferView);
                mem_buffer.data = concat(mem_buffer.data, buffer.buffer.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength));
                mem_buffer.byteLength = mem_buffer.data.byteLength;
            });
        }

        mem_buffers.forEach((buffer) => {
            buffer.uri = (!buffer.embedded) ? buffer.uri : "data:application/octet-stream;base64," + base64( buffer.data );
            gltfJSONNew.buffers.push({uri: buffer.uri, byteLength: buffer.data.byteLength, name: buffer.name});
            buffer.data = (!buffer.embedded) ? buffer.data : undefined;
        });
        gltfJSONNew.bufferViews = bufferViews;

        const removeStringFromArray = (array, targetString) => {
            const index = array.indexOf(targetString);
            if (index !== -1) array.splice(index, 1);
        };

        removeStringFromArray(gltfJSONNew.extensionsRequired, "KHR_draco_mesh_compression");
        removeStringFromArray(gltfJSONNew.extensionsRequired, "EXT_meshopt_compression");
        removeStringFromArray(gltfJSONNew.extensionsRequired, "KHR_mesh_quantization");
        removeStringFromArray(gltfJSONNew.extensionsUsed, "KHR_draco_mesh_compression");
        removeStringFromArray(gltfJSONNew.extensionsUsed, "EXT_meshopt_compression");
        removeStringFromArray(gltfJSONNew.extensionsUsed, "KHR_mesh_quantization");

        gltfJSONNew.bufferViews.forEach((bufferView) => {
            if (bufferView.extensions && bufferView.extensions.EXT_meshopt_compression) usesMeshopt = true;
        });

        gltfJSONNew.meshes.forEach((mesh) => {
            mesh.primitives.forEach((prim) => {
                if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) usesDraco = true;
                Object.entries(prim.attributes).forEach(([key, value]) => {
                    const attribute = prim.attributes[key];
                    const accessor = gltfJSONNew.accessors[attribute];
                    if (isQuantizedCb(attribute, accessor)) usesQuantization = true;
                });
            });
        });
           
        const dracoGeometryExists = usesDraco;
        const moptGeometryExists = usesMeshopt;
        const quantizedGeometryExists = usesQuantization;
        const webpImagesExists = gltf.images.some(img => img.compressedMimeType === ImageMimeType.WEBP);
        const ktxImagesExists = gltf.images.some(img => img.compressedMimeType === ImageMimeType.KTX2);
        
        if(webpImagesExists)        gltfJSONNew.extensionsRequired.push("EXT_texture_webp");
        if(ktxImagesExists)         gltfJSONNew.extensionsRequired.push("KHR_texture_basisu");
        if(dracoGeometryExists)     gltfJSONNew.extensionsRequired.push("KHR_draco_mesh_compression");
        if(moptGeometryExists)      gltfJSONNew.extensionsRequired.push("EXT_meshopt_compression");
        if(quantizedGeometryExists) gltfJSONNew.extensionsRequired.push("KHR_mesh_quantization");

        if(webpImagesExists)        gltfJSONNew.extensionsUsed.push("EXT_texture_webp");
        if(ktxImagesExists)         gltfJSONNew.extensionsUsed.push("KHR_texture_basisu");
        if(dracoGeometryExists)     gltfJSONNew.extensionsUsed.push("KHR_draco_mesh_compression");
        if(moptGeometryExists)      gltfJSONNew.extensionsUsed.push("EXT_meshopt_compression");
        if(quantizedGeometryExists) gltfJSONNew.extensionsUsed.push("KHR_mesh_quantization");

        if(moptGeometryExists) {
            // Add a placeholder buffer as required by spec
            gltfJSONNew.buffers.push({
                byteLength: og_gltf.buffers.reduce((partialSum, buffer) => partialSum + buffer.byteLength, 0),
                extensions: {
                    EXT_meshopt_compression: {
                        fallback: false
                    }
                }
            });
        }

        console.log('gltfJSONNew', gltfJSONNew);
        return {gltfDesc: {uri: path.basename(gltf.path), data: gltfJSONNew}, images: uri_images, buffers: mem_buffers};
    }));
    gltfExportChangedObservable.subscribe( async ({gltfDesc, images, buffers}) => {
        const gltf = JSON.stringify(gltfDesc.data, undefined, 4);

        const raw_buffers = buffers.map((buffer) => { return buffer.data; });

        if(!getIsGlb(gltfDesc.uri))
        {
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
            const json_file = zipWriter.add(gltfDesc.uri, new zip.TextReader(gltf));
            const external_images = images.filter(img => img.data).map((file) => {
                return zipWriter.add(file.uri, file.data instanceof Blob? new zip.BlobReader(file.data) : new zip.Uint8ArrayReader(file.data));
            });
            const external_buffers = buffers.filter(buffer => buffer.data).map((file) => {
                return zipWriter.add(file.uri, file.data instanceof Blob? new zip.BlobReader(file.data) : new zip.Uint8ArrayReader(file.data));
            });
            await Promise.all([ json_file, ...external_buffers, ...external_images ]);
            zipWriter.close();
            const zipFileBlob = await zipWriter.writer.blob;
            const zipFileArrayBuffer = await zipFileBlob.arrayBuffer();
            const dataURL = 'data:application/octet-stream;base64,' + base64(zipFileArrayBuffer);
            //downloadDataURL("file.zip", dataURL);
            downloadBlob("file.zip", zipFileBlob);
        }
        else
        {
            if(getIsGlb(gltfDesc.uri))
            {
                const glbSerializer = new GlbSerializer();
                const glb = glbSerializer.serializeGLBData(gltf, raw_buffers);
                console.log('glb', glb);
                const dataURL = 'data:application/octet-stream;base64,' + base64(glb);
                downloadDataURL(gltfDesc.uri, dataURL);
            }
            else
            {
                const dataURL = 'data:text/plain;charset=utf-8,' +  encodeURIComponent(gltf);
                downloadDataURL(gltfDesc.uri, dataURL);
            }
        }
    });
    
    const ktxjsonExportObservable = uiModel.ktxjsonValuesExport.pipe( map(_ => {
        const gltf = state.gltf;
        const ktx = gltf.ktxDecoder;
        const images = state.compressorParameters.processedImages;
        const params = state.compressorParameters;
        const commands = [];
        const scale  = parseInt(state.compressorParameters.resolutionDownscale.replace(/\D/g, ""));
        
        images.forEach(function (index) {
            const image = gltf.images[index];
            const uri = (image.uri) ? image.uri : "Image_" + index.toString() + '.' + ((image.mimeType) ? image.mimeType.substring(image.mimeType.lastIndexOf("/") + 1) : '');
            const slash_index  = uri.lastIndexOf("/"); 
            const point_index  = uri.lastIndexOf("."); 
            const ext = (point_index < 0) ? "" : uri.substring(point_index + 1);
            const input = (slash_index < 0) ? uri : uri.substring(slash_index + 1);
            const output = ((point_index < 0) ? uri : uri.substring(slash_index + 1, point_index)) + '.ktx2';
            let command = '';
            command += 'toktx';
            command += ' --t2';
            command += ' --2d';
            command += ' --encode ' + (params.compressionTextureEncoding === 'UASTC' ? 'uastc' : 'etc1s');
            if (params.compressionTextureEncoding === 'UASTC') {
                command += ' --uastc_quality ' + ktx.stringToUastcFlags(params.compressionUASTC_Flags);
                if (params.compressionUASTC_Rdo) {
                    command += ' --uastc_rdo_l ' + params.compressionUASTC_Rdo_QualityScalar;
                    command += ' --uastc_rdo_d ' + params.compressionUASTC_Rdo_DictionarySize;
                    command += ' --uastc_rdo_b ' + params.compressionUASTC_Rdo_MaxSmoothBlockErrorScale;
                    command += ' --uastc_rdo_s ' + params.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation;
                    if (params.compressionUASTC_Rdo_DonotFavorSimplerModes) command += ' --uastc_rdo_f';
                }
            } else {
                command += ' --clevel ' + params.compressionETC1S_CompressionLevel;
                command += ' --qlevel ' + params.compressionETC1S_QualityLevel;
                command += ' --max_endpoints ' + params.compressionETC1S_MaxEndPoints;
                command += ' --endpoint_rdo_threshold ' + params.compressionETC1S_EndpointRdoThreshold;
                command += ' --max_selectors ' + params.compressionETC1S_MaxSelectors;
                command += ' --selector_rdo_threshold ' + params.compressionETC1S_SelectorRdoThreshold;
                if (params.compressionETC1S_NoEndpointRdo) command += ' --no_endpoint_rdo';
                if (params.compressionETC1S_NoSelectorRdo) command += ' --no_selector_rdo';
            }
            if (scale > 1) command += ' --resize ' + image.compressedImage.width + 'x' + image.compressedImage.height;
            command += ' ' + output;
            command += ' ' + input;
            commands.push(command);
        });
        return {commands: commands};
    }));
    ktxjsonExportObservable.subscribe( async (commands) => {
        const json_commands = JSON.stringify(commands);
        const dataURL = 'data:text/plain;charset=utf-8,' +  encodeURIComponent(json_commands);
        downloadDataURL("toktx.json", dataURL);
    });

    // reset the previewing to 3D and preview texture index on model load
    gltfLoadedMulticast.subscribe(_ => {
        state.compressorParameters.previewCompressed = false;
        state.compressorParameters.sliderPosition = 0.5;

        state.compressorParameters.previewMode = GltfState.CompressionComparison.PREVIEW_3D;
        state.compressorParameters.previewTextureIndex = -1;
        state.compressorParameters.previewTextureZoom = {left: 0, right: 1, bottom: 0, top: 1};

        state.compressorParameters.resolutionDownscale= '1x',
        state.compressorParameters.compressionQualityJPEG = 80.0;
        state.compressorParameters.compressionQualityPNG = 8;
        state.compressorParameters.compressionQualityWEBP = 80.0;

        state.compressorParameters.compressionTextureEncoding = "UASTC";
        state.compressorParameters.compressionUASTC_Rdo_Algorithm = "Zstd";

        state.compressorParameters.compressionUASTC_Flags = "DEFAULT";
        state.compressorParameters.compressionUASTC_Rdo = false;
        state.compressorParameters.compressionUASTC_Rdo_Level = 18;
        state.compressorParameters.compressionUASTC_Rdo_QualityScalar = 1.0;
        state.compressorParameters.compressionUASTC_Rdo_DictionarySize = 4096;
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockErrorScale = 10.0;
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation = 18.0;
        state.compressorParameters.compressionUASTC_Rdo_DonotFavorSimplerModes = false;

        state.compressorParameters.compressionETC1S_CompressionLevel = 2;
        state.compressorParameters.compressionETC1S_QualityLevel = 128;
        state.compressorParameters.compressionETC1S_MaxEndPoints = 0;
        state.compressorParameters.compressionETC1S_EndpointRdoThreshold = 1.25;
        state.compressorParameters.compressionETC1S_MaxSelectors = 0;
        state.compressorParameters.compressionETC1S_SelectorRdoThreshold = 1.25;
        state.compressorParameters.compressionETC1S_NoEndpointRdo = false;
        state.compressorParameters.compressionETC1S_NoSelectorRdo = false;

        state.compressorParameters.compressionTextureType = "KTX2";
        state.compressorParameters.processedImages = [];
        state.compressorParameters.compressionGeometryType = "Draco";
        state.compressorParameters.processedMeshes = [];
        state.compressorParameters.compressionQuantizationPositionType = "NONE";
        state.compressorParameters.compressionQuantizationNormalType = "NONE";
        state.compressorParameters.compressionQuantizationTangentType = "NONE";
        state.compressorParameters.compressionQuantizationTexCoords0Type = "NONE";
        state.compressorParameters.compressionQuantizationTexCoords1Type = "NONE";

        state.compressorParameters.compressionDracoEncodingMethod = "EDGEBREAKER";
        state.compressorParameters.compressionSpeedDraco = 7;
        state.compressorParameters.decompressionSpeedDraco = 7;
        state.compressorParameters.compressionDracoQuantizationPositionQuantBits = 16;
        state.compressorParameters.compressionDracoQuantizationNormalQuantBits = 10;
        state.compressorParameters.compressionDracoQuantizationColorQuantBits = 16;
        state.compressorParameters.compressionDracoQuantizationTexcoordQuantBits = 11;
        state.compressorParameters.compressionDracoQuantizationGenericQuantBits = 16;

        state.compressorParameters.compressionMeshOptFilterMethod = "NONE";
        state.compressorParameters.compressionMeshOptFilterMode = "Separate";
        state.compressorParameters.compressionMeshOptFilterQuantizationBits = 16;
        state.compressorParameters.compressionMeshOptReorder = false;
        state.compressorParameters.compressionMOptQuantizationPosition = "NONE";
        state.compressorParameters.compressionMOptQuantizationNormal = "NONE";
        state.compressorParameters.compressionMOptQuantizationTangent = "NONE";
        state.compressorParameters.compressionMOptQuantizationTexCoords0 = "NONE";
        state.compressorParameters.compressionMOptQuantizationTexCoords1 = "NONE";
        state.compressorParameters.positionFilter = "NONE";
        state.compressorParameters.positionFilterMode = "Separate";
        state.compressorParameters.positionFilterBits = 16;
        state.compressorParameters.normalFilter = "NONE";
        state.compressorParameters.normalFilterMode = "Separate";
        state.compressorParameters.normalFilterBits = 16;
        state.compressorParameters.tangentFilter = "NONE";
        state.compressorParameters.tangentFilterMode = "Separate";
        state.compressorParameters.tangentFilterBits = 16;
        state.compressorParameters.tex0Filter = "NONE";
        state.compressorParameters.tex0FilterMode = "Separate";
        state.compressorParameters.tex0FilterBits = 16;
        state.compressorParameters.tex1Filter = "NONE";
        state.compressorParameters.tex1FilterMode = "Separate";
        state.compressorParameters.tex1FilterBits = 16;
        
    });

    // End GSV-KTX

    uiModel.renderEnvEnabled.subscribe( renderEnvEnabled => {
        state.renderingParameters.renderEnvironmentMap = renderEnvEnabled;
    });
    uiModel.blurEnvEnabled.subscribe( blurEnvEnabled => {
        state.renderingParameters.blurEnvironmentMap = blurEnvEnabled;
    });
    listenForRedraw(uiModel.renderEnvEnabled);
    
    uiModel.blurEnvEnabled.subscribe(blurEnvEnabled => state.renderingParameters.blurEnvironmentMap = blurEnvEnabled);
    listenForRedraw(uiModel.blurEnvEnabled);

    uiModel.punctualLightsEnabled.subscribe(punctualLightsEnabled => state.renderingParameters.usePunctual = punctualLightsEnabled);
    listenForRedraw(uiModel.punctualLightsEnabled);

    uiModel.environmentRotation.subscribe(environmentRotation => {
        switch (environmentRotation) {
        case "+Z":
            state.renderingParameters.environmentRotation = 90.0;
            break;
        case "-X":
            state.renderingParameters.environmentRotation = 180.0;
            break;
        case "-Z":
            state.renderingParameters.environmentRotation = 270.0;
            break;
        case "+X":
            state.renderingParameters.environmentRotation = 0.0;
            break;
        }
    });
    listenForRedraw(uiModel.environmentRotation);


    uiModel.clearColor.subscribe(clearColor => state.renderingParameters.clearColor = clearColor);
    listenForRedraw(uiModel.clearColor);

    uiModel.animationPlay.subscribe(animationPlay => {
        if(animationPlay) {
            state.animationTimer.unpause();
        }
        else {
            state.animationTimer.pause();
        }
    });

    uiModel.activeAnimations.subscribe(animations => state.animationIndices = animations);
    listenForRedraw(uiModel.activeAnimations);

    uiModel.hdr.subscribe(hdrFile => {
        resourceLoader.loadEnvironment(hdrFile).then( (environment) => {
            state.environment = environment;
            //We neeed to wait until the environment is loaded to redraw
            redraw = true;
        });
    });

    uiModel.attachGltfLoaded(gltfLoadedMulticast);
    uiModel.updateStatistics(statisticsUpdateObservable);
    uiModel.updateTextureStatistics(texturestatisticsUpdateObservable);

    const sceneChangedStateObservable = uiModel.scene.pipe(map( newSceneIndex => state));
    uiModel.attachCameraChangeObservable(sceneChangedStateObservable);
    gltfLoadedMulticast.connect();
    compressChangedObservable.connect();

    uiModel.orbit.subscribe( orbit => {
        if (state.cameraIndex === undefined) {
            state.userCamera.orbit(orbit.deltaPhi, orbit.deltaTheta);
        }
    });
    listenForRedraw(uiModel.orbit);

    uiModel.pan.subscribe( pan => {

        if(state.compressorParameters.previewMode == GltfState.CompressionComparison.PREVIEW_2D)
        {
            const width = (state.compressorParameters.previewTextureZoom.right - state.compressorParameters.previewTextureZoom.left) * 1.0 / canvas.width;
            const height = (state.compressorParameters.previewTextureZoom.top - state.compressorParameters.previewTextureZoom.bottom) * 1.0 / canvas.height;

            const box = {
                left: state.compressorParameters.previewTextureZoom.left - width * pan.deltaX,
                right: state.compressorParameters.previewTextureZoom.right - width * pan.deltaX,
                bottom: state.compressorParameters.previewTextureZoom.bottom + height * pan.deltaY,
                top: state.compressorParameters.previewTextureZoom.top + height * pan.deltaY,
            };

            // clamp box
            if(box.left < 0 || box.right > 1)
            {
                box.left = state.compressorParameters.previewTextureZoom.left;
                box.right = state.compressorParameters.previewTextureZoom.right;
            }
            if(box.bottom < 0 || box.top > 1)
            {
                box.bottom = state.compressorParameters.previewTextureZoom.bottom;
                box.top = state.compressorParameters.previewTextureZoom.top;
            }
            state.compressorParameters.previewTextureZoom = box;
        }
        else
        {
            if (state.cameraIndex === undefined)
            {
                state.userCamera.pan(pan.deltaX, -pan.deltaY);
            }
        }
    });
    listenForRedraw(uiModel.pan);

    uiModel.zoom.subscribe( zoom => {

        if(state.compressorParameters.previewMode == GltfState.CompressionComparison.PREVIEW_2D)
        {
            const zoomLevel = zoom.deltaZoom > 0? /*zoom out*/ 1.2 : 1.0 / 1.2;

            const width = state.compressorParameters.previewTextureZoom.right - state.compressorParameters.previewTextureZoom.left;
            const height = state.compressorParameters.previewTextureZoom.top - state.compressorParameters.previewTextureZoom.bottom;
            const midX = 0.5 * (state.compressorParameters.previewTextureZoom.right + state.compressorParameters.previewTextureZoom.left);
            const midY = 0.5 * (state.compressorParameters.previewTextureZoom.top + state.compressorParameters.previewTextureZoom.bottom);

            // Clamp zoom level
            if(zoomLevel < 1.0 && (width < 0.002 || height < 0.002))
            {
                return;
            }

            state.compressorParameters.previewTextureZoom = {
                left: midX - zoomLevel * width * 0.5,
                right: midX + zoomLevel * width * 0.5,
                bottom: midY - zoomLevel * height * 0.5,
                top: midY + zoomLevel * height * 0.5,
            };
            // clamp zoom
            const clamp = (x, min, max) => Math.max(Math.min(x, max), min);
            state.compressorParameters.previewTextureZoom = {
                left: clamp(state.compressorParameters.previewTextureZoom.left, 0, 0.95),
                right: clamp(state.compressorParameters.previewTextureZoom.right, 0.05, 1),
                bottom: clamp(state.compressorParameters.previewTextureZoom.bottom, 0, 0.95),
                top: clamp(state.compressorParameters.previewTextureZoom.top, 0.05, 1),
            };
        }
        else
        {        
            if (state.cameraIndex === undefined)
            {
                state.userCamera.zoomBy(zoom.deltaZoom);
            }
        }
    });
    listenForRedraw(uiModel.zoom);

    // configure the animation loop
    const past = {};
    const update = () => {
        const devicePixelRatio = window.devicePixelRatio || 1;

        // set the size of the drawingBuffer based on the size it's displayed.
        canvas.width = Math.floor(canvas.clientWidth * devicePixelRatio);
        canvas.height = Math.floor(canvas.clientHeight * devicePixelRatio);
        redraw |= !state.animationTimer.paused && state.animationIndices.length > 0;
        redraw |= past.width != canvas.width || past.height != canvas.height;
        past.width = canvas.width;
        past.height = canvas.height;
        
        if (redraw) {

            const imageSlider = document.getElementById('imageSlider');
            if(imageSlider !== null){
                imageSlider.firstChild.childNodes[5].firstChild.childNodes[1].firstChild.style.height = canvas.height + "px";
                imageSlider.firstChild.childNodes[5].firstChild.childNodes[1].firstChild.appendChild(document.getElementById('custom-slider'));
            }
            view.renderFrame(state, canvas.width, canvas.height);
            redraw = false;
        }

        window.requestAnimationFrame(update);
    };

    // After this start executing animation loop.
    window.requestAnimationFrame(update);
};
