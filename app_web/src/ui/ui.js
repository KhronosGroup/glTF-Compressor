import Vue from 'vue/dist/vue.esm.js';
import VueRx from 'vue-rx';
import { Subject } from 'rxjs';
import './sass.scss';
import Buefy from 'buefy';

Vue.use(VueRx, { Subject });
Vue.use(Buefy);

// general components
Vue.component('toggle-button', {
    props: ['ontext', 'offtext'],
    template:'#toggleButtonTemplate',
    data(){
        return {
            name: "Play",
            isOn: false
        };
    },
    mounted(){
        this.name = this.ontext;
    },
    methods:
    {
        buttonclicked: function()
        {
            this.isOn = !this.isOn;
            this.name = this.isOn ? this.ontext : this.offtext;
            this.$emit('buttonclicked', this.isOn);
        },
        setState: function(value)
        {
            this.isOn = value;
            this.name = this.isOn ? this.ontext : this.offtext;
        }
    }
});

const eventBus = new Vue();

Vue.component("tree-view-node", {
    template: "#tree-view-node-template",
    props: {
        item: Object,
    },
    data: function() {
        return {
            isOpen: true
        };
    },
    computed: {
        hasMesh: function() {
            return this.item.mesh > -1;
        },
        isFolder: function() {
            return this.item.children && this.item.children.length;
        }
    },
    // mounted() {
    //     eventBus.$on('toggle-event', data => {
    //         this.toggle();
    //     });
    //},
    methods: {
        toggle: function() {
            if (this.isFolder) {
                this.isOpen = !this.isOpen;
            }
        },
        toTable(item){
            if(item.mesh === undefined)
                return;

            if(document.getElementById('mesh_node_' + item.name).checked){

                if(document.getElementById('mesh_table_row_' + item.mesh) === null){

                    app.selectedGeometry.push([item.mesh, true]);

                    // Create an empty table
                    const newTable = document.createElement("table");
                    newTable.setAttribute('id', 'mesh_table_row_' + item.mesh);
                    newTable.setAttribute('style', 'margin-bottom:5px;');

                    // Insert row
                    var rows = [];
                    var cell1, cell2, cell3;
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell1.innerHTML = "Name";
                    cell2.innerHTML = item.meshName;
                    cell2.colSpan   = "2";
                    
                    // Insert row 
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell1.innerHTML = "Instances";
                    cell2.innerHTML = item.meshInstances.length+1;
                    cell2.colSpan   = "2";

                    // Insert row 
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell1.innerHTML = "Primitives";
                    cell2.innerHTML = item.primitivesLength;
                    cell2.colSpan   = "2";

                    // Insert row
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell3 = rows[rows.length-1].insertCell(2);
                    cell1.innerHTML = "Compression";
                    cell2.innerHTML = "Before";
                    cell3.innerHTML = "After";

                    // Insert row
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell3 = rows[rows.length-1].insertCell(2);
                    cell1.innerHTML = "Format";
                    cell2.innerHTML = item.compressionFormatBefore;
                    cell3.innerHTML = item.compressionFormatAfter;

                    // Insert row
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell3 = rows[rows.length-1].insertCell(2);
                    cell1.innerHTML  = "DiskSize";
                    cell2.innerHTML = item.diskSizeBefore;
                    cell3.innerHTML = item.diskSizeAfter;

                    // Insert row
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell3 = rows[rows.length-1].insertCell(2);
                    cell1.innerHTML  = "GPUSize";
                    cell2.innerHTML = item.gpuSizeBefore;
                    cell3.innerHTML = item.gpuSizeAfter;

                    // Insert row
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell3 = rows[rows.length-1].insertCell(2);
                    cell1.innerHTML  = "BboxChangeMin";
                    cell2.innerHTML = "";
                    cell3.innerHTML = "";

                    // Insert row
                    rows.push(newTable.insertRow(-1));
                    cell1 = rows[rows.length-1].insertCell(0);
                    cell2 = rows[rows.length-1].insertCell(1);
                    cell3 = rows[rows.length-1].insertCell(2);
                    cell1.innerHTML  = "BboxChangeMax";
                    cell2.innerHTML = "";
                    cell3.innerHTML = "";

                    const table = document.getElementById('geometry_table');
                    table.appendChild(newTable);
                }
            }
            else
            {
                let t = document.getElementById('mesh_table_row_' + item.mesh);
                if(t){
                    t.remove();
                    app.selectedGeometry.push([item.mesh, false]);
                }
            }
        },
        checkChild: function(item) {
            this.toTable(item);

            item.meshInstances.forEach(i => {
                document.getElementById('mesh_node_' + i).checked = document.getElementById('mesh_node_' + this.item.name).checked;
            });

            item.children.forEach(child => {
                document.getElementById('mesh_node_' + child.name).checked = document.getElementById('mesh_node_' + this.item.name).checked;
                this.checkChild(child);
            });
        },
        checkChildren: function() {
            app.selectedGeometry = [];
            this.checkChild(this.item);
        }
    }
});

Vue.component('json-to-ui-template', {
    props: ['data', 'isinner'],
    template:'#jsonToUITemplate'
});

Vue.component('geometry-template', {
    props: ['data'],
    template:'#geometryTable'
});

Vue.component('texture-details', {
    props: ['data'],
    template:'#textureDetailsTemplate',
    data() {
        return {
            pressed: [],
            name: [],
        };
    },
    mounted(){
        for(let i=0; i<this.data.length; i++) {
            this.pressed.push(false);
            this.name.push('Compare');
        }
    },
    watch: { 
        data: function () {
            this.pressed = [];
            this.name =  [];
            for(let i=0; i<this.data.length; i++) {
                this.pressed.push(false);
                this.name.push('Compare');
            }
        },
    },
    methods: {
        togglePressed: function(selected) {
            for(let i=0; i<this.data.length; i++) {
                if(i === selected){
                    this.$set(this.pressed, selected, !this.pressed[selected]);
                    this.$set(this.name, selected, this.pressed[selected] ? '3D View' : 'Compare');    
                }
                else{
                    this.$set(this.pressed, i, false);
                    this.$set(this.name, i, 'Compare');
                }
            }
            this.$emit('buttonclicked', selected);
        }
    }
});

export const app = new Vue({
    domStreams: ['modelChanged$', 'flavourChanged$', 'sceneChanged$', 'cameraChanged$',
        'environmentChanged$', 'debugchannelChanged$', 'tonemapChanged$', 'skinningChanged$',
        'punctualLightsChanged$', 'iblChanged$', 'blurEnvChanged$', 'morphingChanged$',
        'addEnvironment$', 'colorChanged$', 'environmentRotationChanged$', 'animationPlayChanged$', 'selectedAnimationsChanged$',
        'variantChanged$', 'exposureChanged$', "clearcoatChanged$", "sheenChanged$", "transmissionChanged$",
        'cameraExport$', 'captureCanvas$','iblIntensityChanged$', 'comparisonViewChanged$', 'compressionDracoEncodingMethodSelectionChanged$',
        'compressionMOptQuantizationPositionChanged$', 'compressionMOptQuantizationNormalChanged$', 'compressionMOptQuantizationTangentChanged$',
        'compressionMOptQuantizationTexCoords0Changed$', 'compressionMOptQuantizationTexCoords1Changed$', 
        'compressionMeshOptFilterMethodSelectionChanged$', 'compressionMeshOptFilterModeSelectionChanged$', 'compressionMeshOptFilterQuantizationBitsChanged$',
        'compressionMeshOptQuantizationColorQuantBitsChanged$', 'compressionMeshOptQuantizationTexcoordQuantBitsChanged$', 'compressionMeshOptReorderChanged$',
        'compressionSpeedDracoChanged$', 'decompressionSpeedDracoChanged$', 'compressionDracoQuantizationPositionQuantBitsChanged$', 'compressionDracoQuantizationNormalQuantBitsChanged$',
        'compressionDracoQuantizationColorQuantBitsChanged$', 'compressionDracoQuantizationTexcoordQuantBitsChanged$', 'compressionDracoQuantizationGenericQuantBitsChanged$',
        'compressionDracoQuantizationTangentQuantBitsChanged$',
        'compressionDracoQuantizationWeightQuantBitsChanged$',
        'compressionDracoQuantizationJointQuantBitsChanged$',
        'positionFilterChanged$',
        'positionFilterModeChanged$',
        'positionFilterBitsChanged$',
        'normalFilterChanged$',
        'normalFilterModeChanged$',
        'normalFilterBitsChanged$',
        'tangentFilterChanged$',
        'tangentFilterModeChanged$',
        'tangentFilterBitsChanged$',
        'tex0FilterChanged$',
        'tex0FilterModeChanged$',
        'tex0FilterBitsChanged$',
        'tex1FilterChanged$',
        'tex1FilterModeChanged$',
        'tex1FilterBitsChanged$',
        'compressionQuantizationPositionTypeSelectionChanged$', 'compressionQuantizationNormalTypeSelectionChanged$', 'compressionQuantizationTangentTypeSelectionChanged$',
        'compressionQuantizationTexCoords0TypeSelectionChanged$', 'compressionQuantizationTexCoords1TypeSelectionChanged$',
        'texturesSelectionChanged$', 'compressionTextureSelectionChanged$', 'compressionUASTC_Rdo_AlgorithmSelectionChanged$', 
        'compressionTextureEncodingSelectionChanged$', 'compressionTextureResolutionSelectionChanged$', 'compressionGeometrySelectionChanged$',
        'compressedUASTC_FlagsChanged$', 'compressedUASTC_RdoChanged$', 'compressionUASTC_Rdo_LevelChanged$', 'compressedUASTC_Rdo_DonotFavorSimplerModesChanged$',
        'compressionETC1S_CompressionLevelChanged$', 'compressionETC1S_QualityLevelChanged$', 'compressionETC1S_MaxEndPointsChanged$', 
        'compressionETC1S_EndpointRdoThresholdChanged$', 'compressionETC1S_MaxSelectorsChanged$', 'compressionETC1S_SelectorRdoThresholdChanged$',
        'compressionETC1S_NoEndpointRdoChanged$', 'compressionETC1S_NoSelectorRdoChanged$',
        'compressionUASTC_Rdo_QualityScalarChanged$', 'compressionUASTC_Rdo_DictionarySizeChanged$', 'compressionUASTC_Rdo_MaxSmoothBlockErrorScaleChanged$',
        'compressionUASTC_Rdo_MaxSmoothBlockStandardDeviationChanged$', 'compressionQualityPNGChanged$', 'compressionQualityWEBPChanged$',
        'compressionQualityJPEGChanged$', 'compressGeometry$', 'previewImageSliderChanged$',
        'gltfExport$', 'ktxjsonExport$'],
    data() {
        return {
            fullscreen: false,
            timer: null,
            fullheight: true,
            right: true,
            models: ["DamagedHelmet"],
            flavours: ["glTF", "glTF-Binary", "glTF-Quantized", "glTF-Draco", "glTF-pbrSpecularGlossiness"],
            scenes: [{title: "0"}, {title: "1"}],
            cameras: [{title: "User Camera", index: -1}],
            materialVariants: ["None"],

            animations: [{title: "cool animation"}, {title: "even cooler"}, {title: "not cool"}, {title: "Do not click!"}],
            tonemaps: [{title: "None"}],
            debugchannels: [{title: "None"}],
            xmp: [{title: "xmp"}],
            assetCopyright: "",
            assetGenerator: "",
            statistics: [],

            isGeometryCompressed: false,
            enableMeshHighlighting: true,
            selectedGeometry: [],
            geometrySize: 0,
            geometryCompressedSize: 0,
            geometryStatistics: [],
            geometryCompressorDisplay: false,
            textureCompressorDisplay: false,
            texturesStatistics: [],
            texturesUpdated: false,

            comparisonSlider: true,
            compressionOnly: false,
            compressionStatistics: [],
            compressionBtnTitle: "Compress",
            
            textureType: [{title: "None"}, {title: "Color"}, {title: "Non-color"}, {title: "Normal"}, {title: "All"}],
            selectedTextureType: "None",

            compressionStarted: false,
            compressionCompleted: false,

            compressionGeometryTypes: [{title: "Draco"}, {title: "MeshQuantization"}, {title: "MeshOpt"}, {title: "Uncompressed"}],
            compressionTextureType: [{title: "JPEG"}, {title: "PNG"}, {title: "WEBP"}, {title: "KTX2"}],
            compressionQuantizationPositionTypes: [{title: "NONE"}, {title: "FLOAT"}, {title: "SHORT"}, {title: "SHORT_NORMALIZED"}, {title: "UNSIGNED_SHORT"}, {title: "UNSIGNED_SHORT_NORMALIZED"}, {title: "BYTE"}, {title: "BYTE_NORMALIZED"}, {title: "UNSIGNED_BYTE"}, {title: "UNSIGNED_BYTE_NORMALIZED"}],
            selectedCompressionQuantizationPosition: "NONE",
            compressionQuantizationNormalTypes: [{title: "NONE"}, {title: "FLOAT"}, {title: "SHORT_NORMALIZED"}, {title: "BYTE_NORMALIZED"}],
            selectedCompressionQuantizationNormal: "NONE",
            compressionQuantizationTangentTypes: [{title: "NONE"}, {title: "FLOAT"}, {title: "SHORT_NORMALIZED"}, {title: "BYTE_NORMALIZED"}],
            selectedCompressionQuantizationTangent: "NONE",
            compressionQuantizationTexCoordsTypes: [{title: "NONE"}, {title: "FLOAT"}, {title: "SHORT"}, {title: "SHORT_NORMALIZED"}, {title: "UNSIGNED_SHORT"}, {title: "BYTE"}, {title: "BYTE_NORMALIZED"}, {title: "UNSIGNED_BYTE"}],
            selectedCompressionQuantizationTexCoords0: "NONE",
            selectedCompressionQuantizationTexCoords1: "NONE",

            compressionDracoEncodingMethods: [{title: "EDGEBREAKER"}, {title: "SEQUENTIAL ENCODING"}],
            selectedCompressionDracoEncodingMethod: "EDGEBREAKER",
            compressionSpeedDraco: 7,
            decompressionSpeedDraco: 7,
            compressionDracoQuantizationPositionQuantBits: 16,
            compressionDracoQuantizationNormalQuantBits: 10,
            compressionDracoQuantizationColorQuantBits: 16,
            compressionDracoQuantizationTexcoordQuantBits: 11,
            compressionDracoQuantizationGenericQuantBits: 16,
            compressionDracoQuantizationTangentQuantBits: 16,
            compressionDracoQuantizationWeightQuantBits: 16,
            compressionDracoQuantizationJointQuantBits: 16,

            compressionMeshOptFilterMethods: [{title: "NONE"}, {title: "OCTAHEDRAL"}, {title: "QUATERNION"}, {title: "EXPONENTIAL"}],
            selectedCompressionMeshOptFilterMethod: "NONE",
            compressionMeshOptFilterModes: [{title: "Separate"}, {title: "SharedVector"}, {title: "SharedComponent"}],
            selectedCompressionMeshOptFilterMode: "Separate",
            compressionMeshOptFilterQuantizationBits: 16,
            positionFilter: "NONE",
            positionFilterMode: "Separate",
            positionFilterBits: 16,
            normalFilter: "NONE",
            normalFilterMode: "Separate",
            normalFilterBits: 16,
            tangentFilter: "NONE",
            tangentFilterMode: "Separate",
            tangentFilterBits: 16,
            tex0Filter: "NONE",
            tex0FilterMode: "Separate",
            ex0FilterBits: 16,
            tex1Filter: "NONE",
            tex1FilterMode: "Separate",
            tex1FilterBits: 16,
            selectedCompressionMeshOptReorder: false,
            compressionMOptQuantizationPosition: "NONE",
            compressionMOptQuantizationTangent: "NONE",
            compressionMOptQuantizationNormal: "NONE",
            compressionMOptQuantizationTexCoords0: "NONE",
            compressionMOptQuantizationTexCoords1: "NONE",

            compressionTextureEncoding: [{title: "UASTC"}, {title: "ETC1S"}],
            compressionTextureResolution: [{title: "1x"}, {title: "2x"}, {title: "4x"}, {title: "8x"}, {title: "16x"}, {title: "32x"}],
            
            selectedCompressionGeometryType: "Draco",

            compressedKTX: false,
            selectedCompressionTextureType: "KTX2",
            selectedCompressionTextureEncoding: "UASTC",
            selectedCompressionTextureResolution: "1x",
            compressionQualityJPEG: 80.0,
            compressionQualityPNG: 8,
            compressionQualityWEBP: 80.0,
            previewImageSlider: 0.5,

            compressionBefore: "Before",
            compressionAfter: "After",

            compressionUASTC_Rdo_Algorithms: [{title: "Zstd"}, {title: "Zlib"}],
            compressionUASTC_Flags: [{title: "FASTEST"}, {title: "FASTER"}, {title: "DEFAULT"}, {title: "SLOWER"}, {title: "SLOWEST"}],
            selectedCompressionUASTC_Flags: "DEFAULT",
            selectedCompressionUASTC_Rdo: false,
            selectedCompressionUASTC_Rdo_Algorithm: "Zstd",
            
            selectedCompressionUASTC_Rdo_Level: 18,
            selectedCompressionUASTC_Rdo_QualityScalar: 1.0,
            selectedCompressionUASTC_Rdo_DictionarySize: 4096,
            selectedCompressionUASTC_Rdo_MaxSmoothBlockErrorScale: 10.0,
            selectedCompressionUASTC_Rdo_MaxSmoothBlockStandardDeviation: 18.0,
            selectedCompressionUASTC_Rdo_DonotFavorSimplerModes: false,
            
            selectedCompressionETC1S_CompressionLevel: 2,
            selectedCompressionETC1S_QualityLevel: 128,
            selectedCompressionETC1S_MaxEndPoints: 0,
            selectedCompressionETC1S_EndpointRdoThreshold: 1.25,
            selectedCompressionETC1S_MaxSelectors: 0,
            selectedCompressionETC1S_SelectorRdoThreshold: 1.25,
            selectedCompressionETC1S_NoEndpointRdo: false,
            selectedCompressionETC1S_NoSelectorRdo: false,

            progressValue: 5,
            scrollIntoView: false,

            selectedModel: "DamagedHelmet",
            selectedFlavour: "",
            selectedScene: {},
            selectedCamera: {},
            selectedVariant: "None",
            selectedAnimations: [],
            disabledAnimations: [],

            ibl: true,
            iblIntensity: 0.0,
            punctualLights: true,
            renderEnv: true,
            blurEnv: true,
            clearColor: "",
            environmentRotations: [{title: "+Z"}, {title: "-X"}, {title: "-Z"}, {title: "+X"}],
            selectedEnvironmentRotation: "+Z",
            environments: [{index: 0, name: ""}],
            selectedEnvironment: 0,

            debugChannel: "None",
            exposureSetting: 0,
            toneMap: "None",
            skinning: true,
            morphing: true,
            clearcoatEnabled: true,
            sheenEnabled: true,
            transmissionEnabled: true,
            volumeEnabled: true,
            iorEnabled: true,
            iridescenceEnabled: true,
            anisotropyEnabled: true,
            specularEnabled: true,
            emissiveStrengthEnabled: true,

            activeTab: 0,
            tabsHidden: false,
            loadingComponent: undefined,
            showDropDownOverlay: false,
            uploadedHDR: undefined,
            uiVisible: true,
            

            // these are handls for certain ui change related things
            environmentVisiblePrefState: true,
            volumeEnabledPrefState: true,
        };
    },
    computed: {
        filteredCompressionGeometryItems() {
            // Filter the items array based on the selectedCategory
            return this.isGeometryCompressed ? this.compressionGeometryTypes : this.compressionGeometryTypes.filter(item => item.title !== 'Uncompressed'); 
        }
    },
    created() {
        window.addEventListener("keydown", this.keyListener);
    },
    destroyed() {
        window.removeEventListener("keydown", this.keyListener);
    },
    updated: function()
    {
        if(this.texturesUpdated){
            this.texturesUpdated = false;
            for(let i=0; i<this.texturesStatistics.length; i++)        
                document.getElementById('container_img_' + i).appendChild(this.texturesStatistics[i].img);
        }
        
        var divObj = document.getElementById("targetElement");
        if(divObj && this.scrollIntoView){
            this.scrollIntoView = false;
            divObj.scrollIntoView({ behavior: 'smooth' });
        }      
    },
    mounted: function()
    {
        // remove input class from color picker (added by default by buefy)
        const colorPicker = document.getElementById("clearColorPicker");
        colorPicker.classList.remove("input");

        // test if webgl is present
        const context = canvas.getContext("webgl2", { alpha: false, antialias: true });
        if (context === undefined || context === null) {
            this.error("The sample viewer requires WebGL 2.0, which is not supported by this browser or device. " + 
            "Please try again with another browser, or check https://get.webgl.org/webgl2/ " +
            "if you believe you are seeing this message in error.", 15000);
        }

        // add github logo to navbar
        this.$nextTick(function () {
            // Code that will run only after the
            // entire view has been rendered
            var a = document.createElement('a');
            a.href = "https://github.com/KhronosGroup/glTF-Compressor";
            var img = document.createElement('img');
            img.src ="assets/ui/GitHub-Mark-Light-32px.png";
            img.style.width = "22px";
            img.style.height = "22px";
            document.getElementById("tabsContainer").childNodes[0].childNodes[0].appendChild(a);
            a.appendChild(img);
        });

    },
    methods:
    {
        keyListener(event) {
            if (event.key === "c") 
                this.compressionOnly = !this.compressionOnly;
        },
        disableMeshHighlighting() {
            this.enableMeshHighlighting = false;
        },
        toggleCollapseButtonFA(value, e){
            if(value){
                e.classList.remove('fa-caret-right');
                e.classList.add('fa-caret-down');
            }
            else{
                e.classList.remove('fa-caret-down');
                e.classList.add('fa-caret-right');
            }
        },
        toggleGeometryCompressorDisplay() {
            this.geometryCompressorDisplay = !this.geometryCompressorDisplay;
            const e = document.getElementById('geometryCompressorFA');
            this.toggleCollapseButtonFA(this.geometryCompressorDisplay, e);
        },
        toggleTextureCompressorDisplay() {
            this.textureCompressorDisplay = !this.textureCompressorDisplay;
            const e = document.getElementById('textureCompressorFA');
            this.toggleCollapseButtonFA(this.textureCompressorDisplay, e);
        },
        toggleFullscreen() {
            if(this.fullscreen) {
                app.show();
            } else {
                app.hide();
            }
            this.fullscreen = !this.fullscreen;
        },
        mouseMove() {
            this.$refs.fullscreenIcon.style.display = "block";
            this.setFullscreenIconTimer();
        },
        setFullscreenIconTimer() {
            clearTimeout(this.timer);
            this.timer = window.setTimeout( () => {
                this.$refs.fullscreenIcon.style.display = "none";
            }, 1000);
        },
        setAnimationState: function(value)
        {
            this.$refs.animationState.setState(value);
        },
        iblTriggered: function()
        {
            if(this.ibl == false)
            {
                this.environmentVisiblePrefState = this.renderEnv;
                this.renderEnv = false;
            }
            else{
                this.renderEnv = this.environmentVisiblePrefState;
            }
        },
        transmissionTriggered: function()
        {
            if(this.transmissionEnabled == false)
            {
                this.volumeEnabledPrefState = this.volumeEnabled;
                this.volumeEnabled = false;
            }
            else{
                this.volumeEnabled = this.volumeEnabledPrefState;
            }
        },
        collapseActiveTab : function(event, item) {
            if (item === this.activeTab)
            {
                this.tabsHidden = !this.tabsHidden;
                
                if(this.tabsHidden) {
                    // remove is-active class if tabs are hidden
                    event.stopPropagation();
                    
                    let navElements = document.getElementById("tabsContainer").childNodes[0].childNodes[0].childNodes;
                    for(let elem of navElements) {
                        elem.classList.remove('is-active');
                    }
                } else {
                    // add is-active class to correct element
                    let activeNavElement = document.getElementById("tabsContainer").childNodes[0].childNodes[0].childNodes[item];
                    activeNavElement.classList.add('is-active');
                }
                return;
            }
            else {
                // reset tab visibility
                this.tabsHidden = false;
            }
            
        },
        warn(message) {
            this.$buefy.toast.open({
                message: message,
                type: 'is-warning'
            });
        },
        error(message, duration = 5000) {
            this.$buefy.toast.open({
                message: message,
                type: 'is-danger',
                duration: duration
            });
        },
        goToLoadingState() {
            if(this.loadingComponent !== undefined)
            {
                return;
            }
            this.loadingComponent = this.$buefy.loading.open({
                container: null
            });
        },
        exitLoadingState()
        {
            if(this.loadingComponent === undefined)
            {
                return;
            }
            this.loadingComponent.close();
            this.loadingComponent = undefined;
        },
        onFileChange(e) {
            const file = e.target.files[0];
            this.uploadedHDR = file;
        },
        hide() {
            this.uiVisible = false;
        },
        show() {
            this.uiVisible = true;
        }
        //toggleMeshNodeTree: function() {
            //eventBus.$emit('toggle-event', {});
            //this.$refs.toggleMeshNodeTreeBtn.innerText = this.$refs.toggleMeshNodeTreeBtn.innerText === 'Collapse' ? 'Expand' : 'Collapse';
        //}
    }
}).$mount('#app');

new Vue({
    data() {
        return {
            fullscreen: false,
            timer: null
        };
    },
    methods:
    {
        toggleFullscreen() {
            if (this.fullscreen) {
                app.show();
            } else {
                app.hide();
            }
            this.fullscreen = !this.fullscreen;
        },
        mouseMove() {
            this.$refs.fullscreenIcon.style.display = "block";
            this.setFullscreenIconTimer();
        },
        setFullscreenIconTimer() {
            clearTimeout(this.timer);
            this.timer = window.setTimeout( () => {
                this.$refs.fullscreenIcon.style.display = "none";
            }, 1000);
        }
    }

}).$mount('#canvasUI');

// pipe error messages to UI
(() => {
    const originalWarn = console.warn;
    const originalError = console.error;

    console.warn = function(txt) {
        app.warn(txt);
        originalWarn.apply(console, arguments);
    };
    console.error = function(txt) {
        app.error(txt);
        originalError.apply(console, arguments);
    };

    window.onerror = function(msg, url, lineNo, columnNo, error) {
        app.error([
            'Message: ' + msg,
            'URL: ' + url,
            'Line: ' + lineNo,
            'Column: ' + columnNo,
            'Error object: ' + JSON.stringify(error)
        ].join(' - '));
    };
})();

