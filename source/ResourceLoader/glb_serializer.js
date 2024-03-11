class GlbSerializer
{
    constructor()
    {
        this.glbHeaderInts = 3;
        this.glbChunkHeaderInts = 2;
        this.glbMagic = 0x46546C67;
        this.glbVersion = 2;
        this.jsonChunkType = 0x4E4F534A;
        this.binaryChunkType = 0x004E4942;
    }

    serializeGLBData(gltf, buffers)
    {
        const chunkBuffersData = buffers.map(buffer => {
            return this.getChunkFromBuffer(buffer);
        })
        console.log('buffers', buffers);
        console.log('chunkBuffersData', chunkBuffersData);
        const jsonChunk = this.getChunkFromJsonString(gltf);

        const totalSizeBytes = /*Header*/ 3 * 4 + jsonChunk.byteLength + chunkBuffersData.reduce((acc, curr) => acc + curr.byteLength, 0);
        const glb = new ArrayBuffer(totalSizeBytes);
        const header = new Uint32Array(glb);
        header[0] = 0x46546C67; // Magic
        header[1] = 2; // Version
        header[2] = totalSizeBytes; // byte length
        new Uint8Array(glb, 3*4).set(new Uint8Array(jsonChunk)); // JSON
        let offset = 3 * 4 + jsonChunk.byteLength;
        for (let chunk of chunkBuffersData)
        {
            new Uint8Array(glb, offset).set(new Uint8Array(chunk));
            offset += chunk.byteLength;
        }

        return glb;
    }

    getChunkFromJsonString(jsonString)
    {
        const jsonSlice = new TextEncoder().encode(jsonString);
        const jsonSliceIntSize = Math.floor((jsonSlice.byteLength - 1) / 4 + 1);
        const chunk = new ArrayBuffer(4 * jsonSliceIntSize + 8);
        new Uint8Array(chunk).fill(0x20);
        const header = new Uint32Array(chunk);
        header[0] = jsonSliceIntSize * 4; //jsonSlice.byteLength;
        header[1] = 0x4E4F534A; // JSON
        new Uint8Array(chunk, 8).set(jsonSlice); 

        return chunk;
    }

    getChunkFromBuffer(buffer) // arraybuffer
    {
        const alignedBufferSize = Math.floor((buffer.byteLength - 1) / 4 + 1);
        const chunk = new ArrayBuffer(8 + 4 * alignedBufferSize);
        const header = new Uint32Array(chunk);
        header[0] = alignedBufferSize * 4 ;// buffer.byteLength;
        header[1] = 0x004E4942; // BIN
        new Uint8Array(chunk, 8).set(buffer);    
        
        console.log('buffer', buffer);
        console.log('buffer.byteLength', buffer.byteLength);
        console.log('chunk', chunk);
        console.log('chunk.byteLength', chunk.byteLength);

        return chunk;
    }
}

export { GlbSerializer };
