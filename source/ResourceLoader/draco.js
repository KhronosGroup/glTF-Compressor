class DracoDecoder {

    constructor(dracoLib) {
        if (!DracoDecoder.instance && dracoLib === undefined)
        {
            if (DracoDecoderModule === undefined)
            {
                console.error('Failed to initalize DracoDecoder: draco library undefined');
                return undefined;
            }
            else
            {
                dracoLib = DracoDecoderModule;
            }
        }
        if (!DracoDecoder.instance)
        {
            DracoDecoder.instance = this;
            this.module = null;

            this.initializingPromise = new Promise(resolve => {
                let dracoDecoderType = {};
                dracoDecoderType['onModuleLoaded'] = dracoDecoderModule => {
                    this.module = dracoDecoderModule;
                    resolve();
                };
                dracoLib(dracoDecoderType);
            });
        }
        return DracoDecoder.instance;
    }

    async ready() {
        await this.initializingPromise;
        Object.freeze(DracoDecoder.instance);
    }

}

class DracoEncoder {

    constructor(dracoLib) {
        if (!DracoEncoder.instance && dracoLib === undefined)
        {
            if (DracoEncoderModule === undefined)
            {
                console.error('Failed to initalize DracoEncoder: draco library undefined');
                return undefined;
            }
            else
            {
                dracoLib = DracoEncoderModule;
            }
        }
        if (!DracoEncoder.instance)
        {
            DracoEncoder.instance = this;
            this.module = null;

            this.initializingPromise = new Promise(resolve => {
                let dracoEncoderType = {};
                dracoEncoderType['onModuleLoaded'] = dracoEncoderModule => {
                    this.module = dracoEncoderModule;
                    resolve();
                };
                dracoLib(dracoEncoderType);
            });
        }
        return DracoEncoder.instance;
    }

    async ready() {
        await this.initializingPromise;
        Object.freeze(DracoEncoder.instance);
    }

    getAttributeType(attribute_type) {
        const draco_attribute_types = {
            'NORMAL': this.module.NORMAL,
            'TANGENT': this.module.GENERIC,
            'POSITION': this.module.POSITION,
            'TEXCOORD_0': this.module.TEX_COORD,
            'TEXCOORD_1': this.module.TEX_COORD,
            'JOINTS_0': this.module.GENERIC,
            'WEIGHTS_0': this.module.GENERIC,
            'JOINTS_1': this.module.GENERIC,
            'WEIGHTS_1': this.module.GENERIC
        };
        return draco_attribute_types[attribute_type];
    }
}

export { DracoDecoder, DracoEncoder };
