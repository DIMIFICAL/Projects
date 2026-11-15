(function (Scratch) {
  'use strict';
  if (!Scratch.extensions.unsandboxed) {
    throw new Error('This extension must run unsandboxed');
  }

  const vm = Scratch.vm;
  let mod = null;
  let status = 'idle';

  const config = {
    model: 'isnet_fp16',
    progress: (key, current, total) => {
      if (total) {
        status = `downloading ${Math.round((current / total) * 100)}%`;
      }
    }
  };

  async function getLib() {
    if (!mod) {
      status = 'loading library';
      mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
    }
    return mod;
  }

  function mimeFor(costume) {
    return costume.dataFormat === 'jpg' ? 'image/jpeg' : 'image/png';
  }

  async function addPngCostume(target, bytes, name, resolution, centerX, centerY) {
    const storage = vm.runtime.storage;
    const asset = storage.createAsset(
      storage.AssetType.ImageBitmap,
      storage.DataFormat.PNG,
      bytes,
      null,
      true
    );
    const md5ext = `${asset.assetId}.png`;
    await vm.addCostume(md5ext, {
      name,
      dataFormat: 'png',
      asset,
      md5ext,
      assetId: asset.assetId,
      bitmapResolution: resolution,
      rotationCenterX: centerX,
      rotationCenterY: centerY
    }, target.id);
  }

  class Cutouts {
    getInfo() {
      return {
        id: 'cutouts',
        name: 'Cutouts',
        blocks: [
          {
            opcode: 'uploadAndRemove',
            blockType: Scratch.BlockType.COMMAND,
            text: 'upload image, remove background, add as costume'
          },
          {
            opcode: 'removeBg',
            blockType: Scratch.BlockType.COMMAND,
            text: 'remove background from current costume'
          },
          {
            opcode: 'preload',
            blockType: Scratch.BlockType.COMMAND,
            text: 'preload background remover'
          },
          {
            opcode: 'getStatus',
            blockType: Scratch.BlockType.REPORTER,
            text: 'background remover status'
          },
          {
            opcode: 'costumeSize',
            blockType: Scratch.BlockType.REPORTER,
            text: '[DIM] of current costume',
            arguments: {
              DIM: { type: Scratch.ArgumentType.STRING, menu: 'dims' }
            }
          },
          {
            opcode: 'openLink',
            blockType: Scratch.BlockType.COMMAND,
            text: 'open link [URL]',
            arguments: {
              URL: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'https://yoursite.com/cutouts/license'
              }
            }
          }
        ],
        menus: {
          dims: { acceptReporters: true, items: ['width', 'height'] }
        }
      };
    }

    getStatus() {
      return status;
    }

    async preload() {
      try {
        const m = await getLib();
        if (m.preload) {
          status = 'downloading model';
          await m.preload(config);
        }
        status = 'ready';
      } catch (e) {
        console.error(e);
        status = 'error: ' + e.message;
      }
    }

    pickFile() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => resolve(input.files[0] || null);
        input.oncancel = () => resolve(null);
        input.click();
      });
    }

    async downscale(file, maxSide) {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return new Promise((r) => canvas.toBlob(r, 'image/png'));
    }

    async uploadAndRemove(args, util) {
      try {
        const file = await this.pickFile();
        if (!file) return;
        status = 'processing';

        const m = await getLib();
        const removeBackground = m.removeBackground || m.default;
        const small = await this.downscale(file, 800);
        const out = await removeBackground(small, config);

        const bmp = await createImageBitmap(out);
        const bytes = new Uint8Array(await out.arrayBuffer());
        const name = file.name.replace(/\.[^.]+$/, '');

        await addPngCostume(util.target, bytes, name, 1, bmp.width / 2, bmp.height / 2);

        // switch to the new costume and fit it inside a box (stage units)
        const maxW = 200, maxH = 200;
        util.target.setCostume(util.target.getCostumes().length - 1);
        const fit = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
        util.target.setSize(fit * 100);

        status = 'done';
      } catch (e) {
        console.error(e);
        status = 'error: ' + e.message;
      }
    }

    async removeBg(args, util) {
      try {
        const target = util.target;
        const costume = target.getCostumes()[target.currentCostume];
        if (costume.dataFormat === 'svg') {
          status = 'error: vector costumes not supported';
          return;
        }

        const m = await getLib();
        const removeBackground = m.removeBackground || m.default;

        status = 'processing';
        const out = await removeBackground(
          new Blob([costume.asset.data], { type: mimeFor(costume) }),
          config
        );
        const bytes = new Uint8Array(await out.arrayBuffer());

        await addPngCostume(
          target,
          bytes,
          costume.name + ' (no bg)',
          costume.bitmapResolution,
          costume.rotationCenterX,
          costume.rotationCenterY
        );

        status = 'done';
      } catch (e) {
        console.error(e);
        status = 'error: ' + e.message;
      }
    }

    async costumeSize(args, util) {
      const c = util.target.getCostumes()[util.target.currentCostume];
      if (c.dataFormat === 'svg') return 0; // bitmaps only
      const bmp = await createImageBitmap(new Blob([c.asset.data], { type: mimeFor(c) }));
      const px = args.DIM === 'height' ? bmp.height : bmp.width;
      return px / (c.bitmapResolution || 1);
    }

    async openLink(args) {
      await Scratch.openWindow(String(args.URL));
    }
  }

  Scratch.extensions.register(new Cutouts());
})(Scratch);
