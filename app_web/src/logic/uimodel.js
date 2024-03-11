import { Observable, merge, fromEvent } from 'rxjs';
import { map, filter, startWith, pluck, takeUntil, mergeMap, pairwise, share, tap } from 'rxjs/operators';
import { GltfState } from 'gltf-viewer-source';
import { SimpleDropzone } from 'simple-dropzone';
import { vec2 } from 'gl-matrix';
import normalizeWheel from 'normalize-wheel';

// this class wraps all the observables for the gltf sample viewer state
// the data streams coming out of this should match the data required in GltfState
// as close as possible
class UIModel
{
    constructor(app, modelPathProvider, environments) {
        this.app = app;

        this.app.models = modelPathProvider.getAllKeys();

        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const modelURL = urlParams.get("model");

        this.scene = app.sceneChanged$.pipe(pluck("event", "msg"));
        this.camera = app.cameraChanged$.pipe(pluck("event", "msg"));
        this.environmentRotation = app.environmentRotationChanged$.pipe(pluck("event", "msg"));
        this.app.environments = environments;
        const selectedEnvironment = app.$watchAsObservable('selectedEnvironment').pipe(
            pluck('newValue'),
            map(environmentName => this.app.environments[environmentName].hdr_path)
        );
        const initialEnvironment = "footprint_court";
        this.app.selectedEnvironment = initialEnvironment;

        this.app.tonemaps = Object.keys(GltfState.ToneMaps).map((key) => ({title: GltfState.ToneMaps[key]}));
        this.tonemap = app.tonemapChanged$.pipe(
            pluck("event", "msg"),
            startWith(GltfState.ToneMaps.LINEAR)
        );

        this.app.debugchannels = Object.keys(GltfState.DebugOutput).map((key) => ({title: GltfState.DebugOutput[key]}));
        this.debugchannel = app.debugchannelChanged$.pipe(
            pluck("event", "msg"),
            startWith(GltfState.DebugOutput.NONE)
        );

        this.exposure = app.exposureChanged$.pipe(pluck("event", "msg"));
        this.skinningEnabled = app.skinningChanged$.pipe(pluck("event", "msg"));
        this.morphingEnabled = app.morphingChanged$.pipe(pluck("event", "msg"));
        this.clearcoatEnabled = app.clearcoatChanged$.pipe(pluck("event", "msg"));
        this.sheenEnabled = app.sheenChanged$.pipe(pluck("event", "msg"));
        this.transmissionEnabled = app.transmissionChanged$.pipe(pluck("event", "msg"));
        this.volumeEnabled = app.$watchAsObservable('volumeEnabled').pipe(pluck('newValue'));
        this.iorEnabled = app.$watchAsObservable('iorEnabled').pipe(pluck('newValue'));
        this.iridescenceEnabled = app.$watchAsObservable('iridescenceEnabled').pipe(pluck('newValue'));
        this.anisotropyEnabled = app.$watchAsObservable('anisotropyEnabled').pipe(pluck('newValue'));
        this.specularEnabled = app.$watchAsObservable('specularEnabled').pipe(pluck('newValue'));
        this.emissiveStrengthEnabled = app.$watchAsObservable('emissiveStrengthEnabled').pipe(pluck('newValue'));
        this.iblEnabled = app.iblChanged$.pipe(pluck("event", "msg"));
        this.iblIntensity = app.iblIntensityChanged$.pipe(pluck("event", "msg"));
        this.punctualLightsEnabled = app.punctualLightsChanged$.pipe(pluck("event", "msg"));
        this.renderEnvEnabled = app.$watchAsObservable('renderEnv').pipe(pluck('newValue'));
        this.blurEnvEnabled = app.blurEnvChanged$.pipe(pluck("event", "msg"));
        this.addEnvironment = app.$watchAsObservable('uploadedHDR').pipe(pluck('newValue'));
        this.captureCanvas = app.captureCanvas$.pipe(pluck('event'));
        this.cameraValuesExport = app.cameraExport$.pipe(pluck('event'));

        // GSV-KTX
        this.texturesSelectionType = app.texturesSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionTextureSelectionType = app.compressionTextureSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionTextureResolutionDownscale = app.compressionTextureResolutionSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionQualityJPEG = app.compressionQualityJPEGChanged$.pipe(pluck("event", "msg"));
        this.compressionQualityPNG = app.compressionQualityPNGChanged$.pipe(pluck("event", "msg"));
        this.compressionQualityWEBP = app.compressionQualityWEBPChanged$.pipe(pluck("event", "msg"));
        this.compressedPreviewMode = app.$watchAsObservable('compressionOnly').pipe(map( ({ newValue, oldValue }) => newValue));
        this.comparisonViewMode = app.comparisonViewChanged$.pipe(pluck("event", "msg"));

        this.compressionGeometrySelectionType = app.compressionGeometrySelectionChanged$.pipe(pluck("event", "msg"));
        this.selectedGeometry = app.$watchAsObservable('selectedGeometry').pipe(map( ({ newValue, oldValue }) => newValue));
        this.enableMeshHighlighting = app.$watchAsObservable('enableMeshHighlighting').pipe(map( ({ newValue, oldValue }) => newValue));

        this.compressionQuantizationPositionType = app.compressionQuantizationPositionTypeSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionQuantizationNormalType = app.compressionQuantizationNormalTypeSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionQuantizationTangentType = app.compressionQuantizationTangentTypeSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionQuantizationTexCoords0Type = app.compressionQuantizationTexCoords0TypeSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionQuantizationTexCoords1Type = app.compressionQuantizationTexCoords1TypeSelectionChanged$.pipe(pluck("event", "msg"));

        this.compressionDracoEncodingMethod = app.compressionDracoEncodingMethodSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionSpeedDraco = app.compressionSpeedDracoChanged$.pipe(pluck("event", "msg"));
        this.decompressionSpeedDraco = app.decompressionSpeedDracoChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationPositionQuantBits = app.compressionDracoQuantizationPositionQuantBitsChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationNormalQuantBits = app.compressionDracoQuantizationNormalQuantBitsChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationColorQuantBits = app.compressionDracoQuantizationColorQuantBitsChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationTexcoordQuantBits = app.compressionDracoQuantizationTexcoordQuantBitsChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationGenericQuantBits = app.compressionDracoQuantizationGenericQuantBitsChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationTangentQuantBits = app.compressionDracoQuantizationTangentQuantBitsChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationWeightQuantBits = app.compressionDracoQuantizationWeightQuantBitsChanged$.pipe(pluck("event", "msg"));
        this.compressionDracoQuantizationJointQuantBits = app.compressionDracoQuantizationJointQuantBitsChanged$.pipe(pluck("event", "msg"));

        this.compressionMeshOptFilterMethod = app.compressionMeshOptFilterMethodSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionMeshOptFilterMode = app.compressionMeshOptFilterModeSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionMeshOptFilterQuantizationBits = app.compressionMeshOptFilterQuantizationBitsChanged$.pipe(pluck("event", "msg"));
        this.positionFilter = app.positionFilterChanged$.pipe(pluck("event", "msg"));
        this.positionFilterMode = app.positionFilterModeChanged$.pipe(pluck("event", "msg"));
        this.positionFilterBits = app.positionFilterBitsChanged$.pipe(pluck("event", "msg"));
        this.normalFilter = app.normalFilterChanged$.pipe(pluck("event", "msg"));
        this.normalFilterMode = app.normalFilterModeChanged$.pipe(pluck("event", "msg"));
        this.normalFilterBits = app.normalFilterBitsChanged$.pipe(pluck("event", "msg"));
        this.tangentFilter = app.tangentFilterChanged$.pipe(pluck("event", "msg"));
        this.tangentFilterMode = app.tangentFilterModeChanged$.pipe(pluck("event", "msg"));
        this.tangentFilterBits = app.tangentFilterBitsChanged$.pipe(pluck("event", "msg"));
        this.tex0Filter = app.tex0FilterChanged$.pipe(pluck("event", "msg"));
        this.tex0FilterMode = app.tex0FilterModeChanged$.pipe(pluck("event", "msg"));
        this.tex0FilterBits = app.tex0FilterBitsChanged$.pipe(pluck("event", "msg"));
        this.tex1Filter = app.tex1FilterChanged$.pipe(pluck("event", "msg"));
        this.tex1FilterMode = app.tex1FilterModeChanged$.pipe(pluck("event", "msg"));
        this.tex1FilterBits = app.tex1FilterBitsChanged$.pipe(pluck("event", "msg"));
        
        this.compressionMeshOptFilterQuantizationBits = app.compressionMeshOptFilterQuantizationBitsChanged$.pipe(pluck("event", "msg"));
        
        this.compressionMeshOptReorder = app.compressionMeshOptReorderChanged$.pipe(pluck("event", "msg"));
        
        this.compressionMOptQuantizationPosition = app.compressionMOptQuantizationPositionChanged$.pipe(pluck("event", "msg"));
        this.compressionMOptQuantizationNormal = app.compressionMOptQuantizationNormalChanged$.pipe(pluck("event", "msg"));
        this.compressionMOptQuantizationTangent = app.compressionMOptQuantizationTangentChanged$.pipe(pluck("event", "msg"));
        this.compressionMOptQuantizationTexCoords0 = app.compressionMOptQuantizationTexCoords0Changed$.pipe(pluck("event", "msg"));
        this.compressionMOptQuantizationTexCoords1 = app.compressionMOptQuantizationTexCoords1Changed$.pipe(pluck("event", "msg"));

        // KTX
        this.compressionTextureEncoding = app.compressionTextureEncodingSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Flags = app.compressedUASTC_FlagsChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo = app.compressedUASTC_RdoChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo_Algorithm = app.compressionUASTC_Rdo_AlgorithmSelectionChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo_Level = app.compressionUASTC_Rdo_LevelChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo_QualityScalar = app.compressionUASTC_Rdo_QualityScalarChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo_DictionarySize = app.compressionUASTC_Rdo_DictionarySizeChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo_MaxSmoothBlockErrorScale = app.compressionUASTC_Rdo_MaxSmoothBlockErrorScaleChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation = app.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviationChanged$.pipe(pluck("event", "msg"));
        this.compressionUASTC_Rdo_DonotFavorSimplerModes = app.compressedUASTC_Rdo_DonotFavorSimplerModesChanged$.pipe(pluck("event", "msg"));
       
        this.compressionETC1S_CompressionLevel = app.compressionETC1S_CompressionLevelChanged$.pipe(pluck("event", "msg"));
        this.compressionETC1S_QualityLevel = app.compressionETC1S_QualityLevelChanged$.pipe(pluck("event", "msg"));
        this.compressionETC1S_MaxEndPoints = app.compressionETC1S_MaxEndPointsChanged$.pipe(pluck("event", "msg"));
        this.compressionETC1S_EndpointRdoThreshold = app.compressionETC1S_EndpointRdoThresholdChanged$.pipe(pluck("event", "msg"));
        this.compressionETC1S_MaxSelectors = app.compressionETC1S_MaxSelectorsChanged$.pipe(pluck("event", "msg"));
        this.compressionETC1S_SelectorRdoThreshold = app.compressionETC1S_SelectorRdoThresholdChanged$.pipe(pluck("event", "msg"));
        this.compressionETC1S_NoEndpointRdo = app.compressionETC1S_NoEndpointRdoChanged$.pipe(pluck("event", "msg"));
        this.compressionETC1S_NoSelectorRdo = app.compressionETC1S_NoSelectorRdoChanged$.pipe(pluck("event", "msg"));

        this.previewImageSlider = app.previewImageSliderChanged$.pipe(pluck("event", "msg"));
        this.compressGeometry = app.compressGeometry$.pipe(pluck("event"));
        this.gltfFilesExport = app.gltfExport$.pipe(pluck('event'));
        this.ktxjsonValuesExport = app.ktxjsonExport$.pipe(pluck('event'));

        const initialClearColor = "#303542";
        this.app.clearColor = initialClearColor;
        this.clearColor = app.colorChanged$.pipe(
            filter(value => value.event !== undefined),
            pluck("event", "msg"),
            startWith(initialClearColor),
            map(hex => /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)),
            filter(color => color !== null),
            map(color => [
                parseInt(color[1], 16) / 255.0,
                parseInt(color[2], 16) / 255.0,
                parseInt(color[3], 16) / 255.0,
                1.0
            ])
        );

        this.animationPlay = app.animationPlayChanged$.pipe(pluck("event", "msg"));
        this.activeAnimations = app.$watchAsObservable('selectedAnimations').pipe(pluck('newValue'));

        const canvas = document.getElementById("canvas");
        canvas.addEventListener('dragenter', () => this.app.showDropDownOverlay = true);
        canvas.addEventListener('dragleave', () => this.app.showDropDownOverlay = false);

        const inputObservables = getInputObservables(canvas, this.app);

        const dropdownGltfChanged = app.modelChanged$.pipe(
            pluck("event", "msg"),
            startWith(modelURL === null ? "DamagedHelmet" : null),
            filter(value => value !== null),
            map(value => {
                app.flavours = modelPathProvider.getModelFlavours(value);
                app.selectedFlavour = "glTF";
                return modelPathProvider.resolve(value, app.selectedFlavour);
            }),
            map(value => ({mainFile: value})),
        );

        const dropdownFlavourChanged = app.flavourChanged$.pipe(
            pluck("event", "msg"),
            map(value => modelPathProvider.resolve(app.selectedModel, value)),
            map(value => ({mainFile: value})),
        );

        this.model = merge(dropdownGltfChanged, dropdownFlavourChanged, inputObservables.droppedGltf);
        this.hdr = merge(selectedEnvironment, this.addEnvironment, inputObservables.droppedHdr).pipe(
            startWith(environments[initialEnvironment].hdr_path)
        );

        merge(this.addEnvironment, inputObservables.droppedHdr)
            .subscribe(hdrPath => {
                this.app.environments[hdrPath.name] = {
                    title: hdrPath.name,
                    hdr_path: hdrPath,
                };
                this.app.selectedEnvironment = hdrPath.name;
            });

        this.variant = app.variantChanged$.pipe(pluck("event", "msg"));

        // remove last filename
        this.model
            .pipe(filter(() => this.app.models.at(-1) === this.lastDroppedFilename))
            .subscribe(() => {
                this.app.models.pop();
                this.lastDroppedFilename = undefined;
            });

        let droppedGLtfFileName = inputObservables.droppedGltf.pipe(map(droppedGltf => droppedGltf.mainFile.name));

        if (modelURL !== null) {
            const loadFromUrlObservable = new Observable(subscriber => subscriber.next({mainFile: modelURL}));
            droppedGLtfFileName = merge(droppedGLtfFileName, loadFromUrlObservable.pipe(map(data => data.mainFile)));
            this.model = merge(this.model, loadFromUrlObservable);
        }

        droppedGLtfFileName
            .pipe(filter(filename => filename !== undefined))
            .subscribe(filename => {
                filename = filename.split('/').pop();
                let fileExtension = filename.split('.').pop();
                filename = filename.substr(0, filename.lastIndexOf('.'));

                this.app.models.push(filename);
                this.app.selectedModel = filename;
                this.lastDroppedFilename = filename;

                app.flavours = [fileExtension];
                app.selectedFlavour = fileExtension;
            });

        this.orbit = inputObservables.orbit;
        this.pan = inputObservables.pan;
        this.zoom = inputObservables.zoom;
    }

    attachGltfLoaded(gltfLoaded)
    {
        this.attachCameraChangeObservable(gltfLoaded);
        gltfLoaded.subscribe(state => {
            const gltf = state.gltf;

            this.app.assetCopyright = gltf.asset.copyright ?? "N/A";
            this.app.assetGenerator = gltf.asset.generator ?? "N/A";
            
            this.app.selectedScene = state.sceneIndex;
            this.app.scenes = gltf.scenes.map((scene, index) => ({
                title: scene.name ?? `Scene ${index}`,
                index: index
            }));

            this.app.selectedAnimations = state.animationIndices;

            this.app.materialVariants = ["None", ...gltf?.variants.map(variant => variant.name)];

            this.app.setAnimationState(true);
            this.app.animations = gltf.animations.map((animation, index) => ({
                title: animation.name ?? `Animation ${index}`,
                index: index
            }));

            this.app.xmp = gltf?.extensions?.KHR_xmp_json_ld?.packets[gltf?.asset?.extensions?.KHR_xmp_json_ld.packet] ?? null;
        });
    }

    updateStatistics(statisticsUpdateObservable)
    {
        statisticsUpdateObservable.subscribe(
            data => {
                let statistics = {};
                statistics["Mesh Count"] = data.meshCount;
                statistics["Triangle Count"] = data.faceCount;
                statistics["Opaque Material Count"] = data.opaqueMaterialsCount;
                statistics["Transparent Material Count"] = data.transparentMaterialsCount;
                this.app.statistics = statistics;

                this.app.geometryStatistics = data.geometryData;
                this.app.geometryStatistics.length = data.meshCount;
                this.app.geometrySize = data.geometrySize;
                this.app.enableMeshHighlighting = true;
                this.app.isGeometryCompressed = data.isGeometryCompressed;
                this.app.selectedCompressionGeometryType = "Draco";
                this.app.selectedCompressionQuantizationPosition = "NONE";
                this.app.selectedCompressionQuantizationNormal = "NONE";
                this.app.selectedCompressionQuantizationTangent = "NONE";
                this.app.selectedCompressionQuantizationTexCoords0 = "NONE";
                this.app.selectedCompressionQuantizationTexCoords1 = "NONE";

                this.app.selectedCompressionDracoEncodingMethod = "EDGEBREAKER";
                this.app.compressionSpeedDraco = 7;
                this.app.decompressionSpeedDraco = 7;
                this.app.compressionDracoQuantizationPositionQuantBits = 16;
                this.app.compressionDracoQuantizationNormalQuantBits = 10;
                this.app.compressionDracoQuantizationColorQuantBits = 16;
                this.app.compressionDracoQuantizationTexcoordQuantBits = 11;
                this.app.compressionDracoQuantizationGenericQuantBits = 16;
    
                this.app.selectedCompressionMeshOptFilterMethod = "NONE";
                this.app.selectedCompressionMeshOptFilterMode = "Separate";
                this.app.compressionMeshOptFilterQuantizationBits = 16;
                this.app.positionFilter = "NONE";
                this.app.positionFilterMode = "Separate";
                this.app.positionFilterBits = 16;
                this.app.normalFilter = "NONE";
                this.app.normalFilterMode = "Separate";
                this.app.normalFilterBits = 16;
                this.app.tangentFilter = "NONE";
                this.app.tangentFilterMode = "Separate";
                this.app.tangentFilterBits = 16;
                this.app.tex0Filter = "NONE";
                this.app.tex0FilterMode = "Separate";
                this.app.tex0FilterBits = 16;
                this.app.tex1Filter = "NONE";
                this.app.tex1FilterMode = "Separate";
                this.app.tex1FilterBits = 16;
        
                this.app.selectedCompressionMeshOptReorder = false;
                this.app.compressionMOptQuantizationPosition = "NONE";
                this.app.compressionMOptQuantizationNormal = "NONE";
                this.app.compressionMOptQuantizationTangent = "NONE";
                this.app.compressionMOptQuantizationTexCoords0 = "NONE";
                this.app.compressionMOptQuantizationTexCoords1 = "NONE";
            }
        );
    }

    updateTextureStatistics(statisticsUpdateObservable)
    {
        statisticsUpdateObservable.subscribe(
            data => {
                let compressionStatistics = {};
                compressionStatistics["Before"] = this.app.geometrySize.toFixed(2) + " + " + data.texturesSize.toFixed(2) + " = " + (this.app.geometrySize+data.texturesSize).toFixed(2) + " mb";
                compressionStatistics["After"] = "";
                this.app.compressionStatistics = compressionStatistics;
                this.app.texturesStatistics = data.textures;
                this.app.texturesUpdated = true;

                this.app.compressionBtnTitle = "Compress";
                this.app.comparisonSlider = true;
                this.app.compressionOnly = false;
                this.app.compressionStarted = false;
                this.app.compressionCompleted = false;
                this.app.selectedTextureType = "None";
                this.app.selectedCompressionTextureType = "KTX2";
                this.app.selectedCompressionTextureEncoding = "UASTC";
                this.app.selectedCompressionTextureResolution = "1x";
                this.app.compressionQualityJPEG = 80.0;
                this.app.compressionQualityPNG = 8;
                this.app.compressionQualityWEBP = 80.0;
                this.app.previewImageSlider = 0.5;
                this.app.compressedKTX = false;

                this.app.selectedCompressionUASTC_Flags = "DEFAULT";
                this.app.selectedCompressionUASTC_Rdo = false;
                this.app.selectedCompressionUASTC_Rdo_Level = 18;
                this.app.selectedCompressionUASTC_Rdo_QualityScalar = 1.0;
                this.app.selectedCompressionUASTC_Rdo_DictionarySize = 4096;
                this.app.selectedCompressionUASTC_Rdo_MaxSmoothBlockErrorScale = 10.0;
                this.app.selectedCompressionUASTC_Rdo_MaxSmoothBlockStandardDeviation = 18.0;
                this.app.selectedCompressionUASTC_Rdo_DonotFavorSimplerModes = false;

                this.app.selectedCompressionETC1S_CompressionLevel = 2;
                this.app.selectedCompressionETC1S_QualityLevel = 128;
                this.app.selectedCompressionETC1S_MaxEndPoints = 0;
                this.app.selectedCompressionETC1S_EndpointRdoThreshold = 1.25;
                this.app.selectedCompressionETC1S_MaxSelectors = 0;
                this.app.selectedCompressionETC1S_SelectorRdoThreshold = 1.25;
                this.app.selectedCompressionETC1S_NoEndpointRdo = false;
                this.app.selectedCompressionETC1S_NoSelectorRdo = false;
            }
        );
    }

    updateCompressionStatistics(statisticsUpdateObservable)
    {
        statisticsUpdateObservable.subscribe(
            data => {
                let doneGeometry = data.meshes.length > 0;
                let doneTextures = data.textures.some(texture => texture.isCompleted);
                let done = doneGeometry | doneTextures;

                data.meshes.forEach(mesh => {
                    let table_row = document.getElementById('mesh_table_row_' + mesh.index);
                    table_row.rows[4].cells[2].innerHTML = mesh.compressionFormatAfter;
                    table_row.rows[5].cells[2].innerHTML = mesh.diskSizeAfter;
                    table_row.rows[6].cells[2].innerHTML = mesh.gpuSizeAfter;
                    table_row.rows[7].cells[2].innerHTML = mesh.bboxErrorMin;
                    table_row.rows[8].cells[2].innerHTML = mesh.bboxErrorMax;
                });

                this.app.geometryStatistics = data.geometryData;
                if(doneGeometry)
                    this.app.geometryStatistics.length = data.meshes.length;
                this.app.geometryCompressedSize = data.geometrySize;
                
                this.app.compressionStatistics["After"] = done ? (data.geometrySize.toFixed(2) + " + " + data.texturesSize.toFixed(2) + " = " + (data.geometrySize + data.texturesSize).toFixed(2) + " mb") : "";
                this.app.texturesStatistics = data.textures;
                this.app.compressionCompleted = done;
                this.app.compressedKTX |= doneTextures & this.app.selectedCompressionTextureType === "KTX2";
                this.app.compressionBtnTitle = "Compress";
                this.app.scrollIntoView = true;
            },
        );
    }

    updateCompressionButton(i, total, text)
    {
        this.app.compressionCompleted = false;
        this.app.compressionStarted = (i < total);
        this.app.progressValue = (i/total)*100;
        this.app.compressionBtnTitle = "Compressing " + text + " (" + i + "/" + total + ")";
    }

    updateEncodingKTX(value)
    {
        this.app.selectedCompressionTextureEncoding = (value === "Color") ? "ETC1S" : "UASTC";
    }

    updateSlider(index, previewMode)
    {
        this.app.compressionBefore = (previewMode === GltfState.CompressionComparison.PREVIEW_2D) ? 'Before\n (' + this.app.texturesStatistics[index].format + ')' : "Before";
        this.app.compressionAfter  = (previewMode === GltfState.CompressionComparison.PREVIEW_2D) ? 'After\n ('  + this.app.texturesStatistics[index].formatCompressed + ')' : "After";
    }

    updateImageSlider(value)
    {
        this.app.previewImageSlider = value;
    }

    disabledAnimations(disabledAnimationsObservable)
    {
        disabledAnimationsObservable.subscribe(data => this.app.disabledAnimations = data);
    }

    attachCameraChangeObservable(sceneChangeObservable)
    {
        const cameraIndices = sceneChangeObservable.pipe(
            map(state => {
                let gltf = state.gltf;
                let cameraIndices = [{title: "User Camera", index: -1}];
                if (gltf.scenes[state.sceneIndex] !== undefined)
                {
                    cameraIndices.push(...gltf.cameras.map( (camera, index) => {
                        if(gltf.scenes[state.sceneIndex].includesNode(gltf, camera.node))
                        {
                            let name = camera.name;
                            if(name === "" || name === undefined)
                            {
                                name = index;
                            }
                            return {title: name, index: index};
                        }
                    }));
                }
                cameraIndices = cameraIndices.filter(function(el) {
                    return el !== undefined;
                });
                return cameraIndices;
            })
        );
        cameraIndices.subscribe(cameras => this.app.cameras = cameras);
        const loadedCameraIndex = sceneChangeObservable.pipe(map(state => state.cameraIndex));
        loadedCameraIndex.subscribe(index => this.app.selectedCamera = index !== undefined ? index : -1 );
    }

    goToLoadingState() {
        this.app.goToLoadingState();
    }

    exitLoadingState()
    {
        this.app.exitLoadingState();
    }
}

const getInputObservables = (inputElement, app) => {
    const observables = {};
    
    const droppedFiles = new Observable(subscriber => {
        const dropZone = new SimpleDropzone(inputElement, inputElement);
        dropZone.on('drop', ({files}) => {
            app.showDropDownOverlay = false;
            subscriber.next(Array.from(files.entries()));
        });
        dropZone.on('droperror', () => {
            app.showDropDownOverlay = false;
            subscriber.error();
        });
    }).pipe(share());

    // Partition files into a .gltf or .glb and additional files like buffers and textures
    observables.droppedGltf = droppedFiles.pipe(
        map(files => ({
            mainFile: files.find(([path]) => path.endsWith(".glb") || path.endsWith(".gltf") || path.endsWith(".vrm")),
            additionalFiles: files.filter(file => !file[0].endsWith(".glb") && !file[0].endsWith(".gltf"))
        })),
        filter(files => files.mainFile !== undefined),
    );

    observables.droppedHdr = droppedFiles.pipe(
        map(files => files.find(([path]) => path.endsWith(".hdr"))),
        filter(file => file !== undefined),
        pluck("1")
    );

    const mouseMove = fromEvent(document, 'mousemove');
    const mouseDown = fromEvent(inputElement, 'mousedown');
    const mouseUp = merge(fromEvent(document, 'mouseup'), fromEvent(document, 'mouseleave'));
    
    inputElement.addEventListener('mousemove', event => event.preventDefault());
    inputElement.addEventListener('mousedown', event => event.preventDefault());
    inputElement.addEventListener('mouseup', event => event.preventDefault());

    const mouseOrbit = mouseDown.pipe(
        filter(event => event.button === 0 && event.shiftKey === false),
        mergeMap(() => mouseMove.pipe(
            pairwise(),
            map( ([oldMouse, newMouse]) => {
                return {
                    deltaPhi: newMouse.pageX - oldMouse.pageX, 
                    deltaTheta: newMouse.pageY - oldMouse.pageY 
                };
            }),
            takeUntil(mouseUp)
        ))
    );

    const mousePan = mouseDown.pipe(
        filter( event => event.button === 1 || event.shiftKey === true),
        mergeMap(() => mouseMove.pipe(
            pairwise(),
            map( ([oldMouse, newMouse]) => {
                return {
                    deltaX: newMouse.pageX - oldMouse.pageX, 
                    deltaY: newMouse.pageY - oldMouse.pageY 
                };
            }),
            takeUntil(mouseUp)
        ))
    );

    const dragZoom = mouseDown.pipe(
        filter( event => event.button === 2),
        mergeMap(() => mouseMove.pipe(takeUntil(mouseUp))),
        map( mouse => ({deltaZoom: mouse.movementY}))
    );
    const wheelZoom = fromEvent(inputElement, 'wheel').pipe(
        map(wheelEvent => normalizeWheel(wheelEvent)),
        map(normalizedZoom => ({deltaZoom: normalizedZoom.spinY }))
    );
    inputElement.addEventListener('scroll', event => event.preventDefault(), { passive: false });
    inputElement.addEventListener('wheel', event => event.preventDefault(), { passive: false });
    const mouseZoom = merge(dragZoom, wheelZoom);

    const touchmove = fromEvent(document, 'touchmove');
    const touchstart = fromEvent(inputElement, 'touchstart');
    const touchend = merge(fromEvent(inputElement, 'touchend'), fromEvent(inputElement, 'touchcancel'));

    const touchOrbit = touchstart.pipe(
        filter(event => event.touches.length === 1),
        mergeMap(() => touchmove.pipe(
            filter(event => event.touches.length === 1),
            map(event => event.touches[0]),
            pairwise(),
            map(([oldTouch, newTouch]) => {
                return {
                    deltaPhi: 2.0 * (newTouch.clientX - oldTouch.clientX),
                    deltaTheta: 2.0 * (newTouch.clientY - oldTouch.clientY),
                };
            }),
            takeUntil(touchend)
        )),
    );

    const touchZoom = touchstart.pipe(
        filter(event => event.touches.length === 2),
        mergeMap(() => touchmove.pipe(
            filter(event => event.touches.length === 2),
            map(event => {
                const pos1 = vec2.fromValues(event.touches[0].clientX, event.touches[0].clientY);
                const pos2 = vec2.fromValues(event.touches[1].clientX, event.touches[1].clientY);
                return vec2.dist(pos1, pos2);
            }),
            pairwise(),
            map(([oldDist, newDist]) => ({ deltaZoom: 0.1 * (oldDist - newDist) })),
            takeUntil(touchend))
        ),
    );

    inputElement.addEventListener('ontouchmove', event => event.preventDefault(), { passive: false });
    inputElement.addEventListener('ontouchstart', event => event.preventDefault(), { passive: false });
    inputElement.addEventListener('ontouchend', event => event.preventDefault(), { passive: false });

    observables.orbit = merge(mouseOrbit, touchOrbit);
    observables.pan = mousePan;
    observables.zoom = merge(mouseZoom, touchZoom);

    // disable context menu
    inputElement.oncontextmenu = () => false;

    return observables;
};

export { UIModel };
