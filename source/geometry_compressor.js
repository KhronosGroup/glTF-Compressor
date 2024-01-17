import {GL} from './Renderer/webgl.js'
import { gltfBuffer } from './gltf/buffer.js';
import { gltfAccessor } from './gltf/accessor.js';
import { gltfBufferView } from './gltf/buffer_view.js';
import { DracoDecoder } from './ResourceLoader/draco.js';

export const GEOMETRY_COMPRESSION_TYPE = {
    QUANTIZATION: "MeshQuantization",
    DRACO: "Draco",
    MESHOPT: "MeshOpt"
};

export class GeometryQuantizationOptions {
    constructor() {
        this.positionCompression = 0; // all available formats
        this.positionCompressionNormalized = true;

        this.normalsCompression = 0; // float, byte/short normalized
        this.normalsCompressionNormalized = false;

        this.texcoord0Compression = 0; // all available formats except unsigned normalized
        this.texcoord0CompressionNormalized = true;
        this.texcoord0CompressionOffset = undefined;
        this.texcoord0CompressionScale = undefined;

        this.texcoord1Compression = 0; // all available formats except unsigned normalized
        this.texcoord1CompressionNormalized = true;
        this.texcoord1CompressionOffset = undefined;
        this.texcoord1CompressionScale = undefined;

        this.tangentsCompression = 0; // float, byte/short normalized
        this.tangentsCompressionNormalized = false;
        this.scale = undefined;
        this.offset = undefined;
    }
}

export class GeometryDracoOptions {
    constructor() {
        this.positionCompressionQuantizationBits = 16;
        this.normalCompressionQuantizationBits = 10;
        this.colorCompressionQuantizationBits = 16;
        this.texcoordCompressionQuantizationBits = 11;
        this.genericQuantizationBits = 32;

        this.compressionLevel = 7;
        this.encodingMethod = "EDGEBREAKER";
    }
}

export class GeometryMeshOptOptions {
    constructor() {
        this.positionCompressionQuantizationBits = 16;
        this.normalCompressionQuantizationBits = 8;
        this.colorCompressionQuantizationBits = 16;
        this.texcoordCompressionQuantizationBits = 12;

        this.positionFilter = "NONE";
        this.positionFilterMode = "Separate";
        this.positionFilterBits = 16;
        this.normalFilter = "NONE";
        this.normalFilterMode = "Separate";
        this.normalFilterBits = 16;
        this.tangentFilter = "NONE";
        this.tangentFilterMode = "Separate";
        this.tangentFilterBits = 16;
        this.tex0Filter = "NONE";
        this.tex0FilterMode = "Separate";
        this.tex0FilterBits = 16;
        this.tex1Filter = "NONE";
        this.tex1FilterMode = "Separate";
        this.tex1FilterBits = 16;
        this.reorder = false;

        this.positionCompression = 0; // all available formats
        this.positionCompressionNormalized = true;

        this.normalsCompression = 0; // float, byte/short normalized
        this.normalsCompressionNormalized = false;

        this.texcoord0Compression = 0; // all available formats except unsigned normalized
        this.texcoord0CompressionNormalized = true;
        this.texcoord0CompressionOffset = undefined;
        this.texcoord0CompressionScale = undefined;

        this.texcoord1Compression = 0; // all available formats except unsigned normalized
        this.texcoord1CompressionNormalized = true;
        this.texcoord1CompressionOffset = undefined;
        this.texcoord1CompressionScale = undefined;

        this.tangentsCompression = 0; // float, byte/short normalized
        this.tangentsCompressionNormalized = false;
        this.scale = undefined;
        this.offset = undefined;
    }
}

export const ComponentDataType = {
    FLOAT: 5126 /*f32*/, 
    SHORT: 5122 /*int16*/, UNSIGNED_SHORT: 5123 /*uint16*/,
    BYTE: 5120 /*int8*/, UNSIGNED_BYTE: 5121 /*uint8*/
};

export function getComponentDataType(type) {
    var component = 0; // case "NONE"
    switch (type)
    {
    case "FLOAT":
        component = ComponentDataType.FLOAT;
        break;
    case "SHORT":
    case "SHORT_NORMALIZED":
        component = ComponentDataType.SHORT;
        break;
    case "UNSIGNED_SHORT":
    case "UNSIGNED_SHORT_NORMALIZED":
        component = ComponentDataType.UNSIGNED_SHORT;
        break;
    case "BYTE":
    case "BYTE_NORMALIZED":
        component = ComponentDataType.BYTE;
        break;
    case "UNSIGNED_BYTE":
    case "UNSIGNED_BYTE_NORMALIZED":
        component = ComponentDataType.UNSIGNED_BYTE;
        break;
    }

    return component;
}

export function isComponentDataTypeNormalized(type) {
    return type === "SHORT_NORMALIZED" || type === "UNSIGNED_SHORT_NORMALIZED" || type === "BYTE_NORMALIZED" || type === "UNSIGNED_BYTE_NORMALIZED";
}

export const NumberOfComponentsMap = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16
};

const gl_ARRAY_BUFFER = 34962;

const to_int16 = (value)  => Math.round(value * 32767.0);
const to_uint16 = (value) => Math.round(value * 65535.0); 
const to_int8 = (value)   => Math.round(value * 127.0);
const to_uint8 = (value)  => Math.round(value * 255.0);

const clamp = (value, minValue, maxValue) => Math.max(minValue, Math.min(value, maxValue));

export function isComponentDataTypeUnsigned(type) {
    return type % 2 == 1;
}
export function getComponentDataTypeSize(type) {
    return type == GL.FLOAT? 4 : type == GL.SHORT || type == GL.UNSIGNED_SHORT? 2 : 1;
}
export function getComponentDataTypeDistinctIntegerNumbers(type) {
    return type == GL.SHORT || type == GL.UNSIGNED_SHORT? 65535 : type == GL.BYTE || type == GL.UNSIGNED_BYTE? 255 : 1;
}

export function fillQuantizedBufferNormalized(inputFloatArray, outputBuffer, componentType, numberOfComponents, count, stride)
{
    const quantizeFunc = 
        componentType == GL.BYTE? to_int8 : 
        componentType == GL.UNSIGNED_BYTE? to_uint8 :
        componentType == GL.SHORT? to_int16 :
        componentType == GL.UNSIGNED_SHORT? to_uint16 : null;

    const compressedTypedView = 
        componentType == GL.BYTE? new Int8Array(outputBuffer) : 
        componentType == GL.UNSIGNED_BYTE? new Uint8Array(outputBuffer) :
        componentType == GL.SHORT? new Int16Array(outputBuffer) :
        componentType == GL.UNSIGNED_SHORT? new Uint16Array(outputBuffer) : new Float32Array(outputBuffer);

    // convert types
    let originalIndex = 0;
    let targetIndex = 0;
    while(originalIndex < numberOfComponents * count)
    {
        for(let j = 0; j < numberOfComponents; j++)
        {
            compressedTypedView[targetIndex + j] = quantizeFunc(inputFloatArray[originalIndex++]);
        }
        targetIndex += stride;
    }
}

export function fillQuantizedBuffer(inputFloatArray, outputBuffer, componentType, numberOfComponents, count, stride)
{
    if(componentType == GL.FLOAT)
    {
        const compressedTypedViewF32 = new Float32Array(outputBuffer);
        compressedTypedViewF32.set(inputFloatArray);
        return;
    }

    const quantizeFunc = 
        componentType == GL.BYTE? (val) => clamp(val, -128, 127) : 
        componentType == GL.UNSIGNED_BYTE? (val) => clamp(val, 0, 255) : 
        componentType == GL.SHORT? (val) => clamp(val, -32768, 32767) : 
        componentType == GL.UNSIGNED_SHORT? (val) => clamp(val, 0, 65535) : null;

    const compressedTypedView = 
        componentType == GL.BYTE? new Int8Array(outputBuffer) : 
        componentType == GL.UNSIGNED_BYTE? new Uint8Array(outputBuffer) :
        componentType == GL.SHORT? new Int16Array(outputBuffer) :
        componentType == GL.UNSIGNED_SHORT? new Uint16Array(outputBuffer) : new Float32Array(outputBuffer);

    // convert types
    let originalIndex = 0;
    let targetIndex = 0;
    while(originalIndex < numberOfComponents * count)
    {
        for(let j = 0; j < numberOfComponents; j++)
        {
            compressedTypedView[targetIndex + j] = quantizeFunc(inputFloatArray[originalIndex++]);
        }
        targetIndex += stride;
    }
}

export function quantize(gltf, inputAccessor, componentType, normalized, offset, scale)
{
    const componentTypeByteSize = getComponentDataTypeSize(componentType);
    const numberOfComponents = NumberOfComponentsMap[`${inputAccessor.type}`];

    // 4 byte aligned
    const byteStride = 4 * (Math.floor((componentTypeByteSize * numberOfComponents - 1) / 4) + 1);

    let inputFloatArrayView = inputAccessor.getNormalizedDeinterlacedView(gltf);
    if(scale !== undefined)
    {
        inputFloatArrayView = inputFloatArrayView.map((v,i) => (v + offset[i % numberOfComponents]) * scale); // inverse of T*R*S
    }

    // create a new buffer
    const buffer = new gltfBuffer();
    buffer.byteLength = inputAccessor.count * byteStride;
    buffer.buffer = new ArrayBuffer(buffer.byteLength);
    buffer.name = "Quantized buffer";
    gltf.buffers.push(buffer);

    // convert to the requested quantization format
    if(normalized)
        fillQuantizedBufferNormalized(inputFloatArrayView, buffer.buffer, componentType, numberOfComponents, inputAccessor.count, byteStride / componentTypeByteSize)
    else
        fillQuantizedBuffer(inputFloatArrayView, buffer.buffer, componentType, numberOfComponents, inputAccessor.count, byteStride / componentTypeByteSize)

    // create a new bufferView
    const bufferView = new gltfBufferView();
    bufferView.buffer = gltf.buffers.length - 1;
    bufferView.byteOffset = 0;
    bufferView.byteLength = buffer.byteLength;
    bufferView.byteStride = byteStride;
    bufferView.target = gl_ARRAY_BUFFER;
    bufferView.name = "Quantized"+inputAccessor.name;
    gltf.bufferViews.push(bufferView);

    // create a new accessor
    const accessor = new gltfAccessor();
    accessor.bufferView = gltf.bufferViews.length - 1;
    accessor.byteOffset = 0;
    accessor.componentType = componentType;
    accessor.normalized = normalized;
    accessor.count = inputAccessor.count;
    accessor.type = inputAccessor.type;
    accessor.max = inputAccessor.max;
    accessor.min = inputAccessor.min;
    accessor.sparse = undefined;
    accessor.name = "Quantized "+inputAccessor.name;
    gltf.accessors.push(accessor);

    const minValue = new Array(numberOfComponents).fill(Number.MAX_VALUE);
    const maxValue = new Array(numberOfComponents).fill(-Number.MAX_VALUE);

    const quantizedFloatArrayView = accessor.getNormalizedDeinterlacedView(gltf);
    quantizedFloatArrayView.forEach((v, i) => {
        const comp = i % numberOfComponents;
        minValue[comp] = Math.min(minValue[comp], v);
        maxValue[comp] = Math.max(maxValue[comp], v);        
    });
    accessor.min = minValue;
    accessor.max = maxValue;

    return gltf.accessors.length - 1;
}