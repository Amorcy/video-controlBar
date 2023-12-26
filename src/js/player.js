// import Promise from 'promise-polyfill';

import utils from './utils';
import handleOption from './options';
import { i18n } from './i18n';
import Template from './template';
import Icons from './icons';
import Events from './events';
import FullScreen from './fullscreen';
import User from './user';
import Bar from './bar';
import Timer from './timer';
import Controller from './controller';
import Setting from './setting';
import tplVideo from '../template/video.art';

let index = 0;
const instances = [];

class DPlayer {
    /**
     * DPlayer constructor function
     *
     * @param {Object} options - See README
     * @constructor
     */
    constructor(options) {
        this.options = handleOption({ preload: options.video.type === 'webtorrent' ? 'none' : 'metadata', ...options });

        if (this.options.video.quality) {
            this.qualityIndex = this.options.video.defaultQuality;
            this.quality = this.options.video.quality[this.options.video.defaultQuality];
        }
        this.tran = new i18n(this.options.lang).tran;
        this.events = new Events();
        this.user = new User(this);
        this.container = this.options.container;
        this.noticeList = {};

        this.container.classList.add('dplayer');

        if (this.options.live) {
            this.container.classList.add('dplayer-live');
        } else {
            this.container.classList.remove('dplayer-live');
        }

        this.arrow = this.container.offsetWidth <= 500;
        if (this.arrow) {
            this.container.classList.add('dplayer-arrow');
        }

        // multi subtitles defaultSubtitle add index, off option
        if (this.options.subtitle) {
            if (Array.isArray(this.options.subtitle.url)) {
                const offSubtitle = {
                    subtitle: '',
                    lang: 'off',
                };
                this.options.subtitle.url.push(offSubtitle);
                if (this.options.subtitle.defaultSubtitle) {
                    if (typeof this.options.subtitle.defaultSubtitle === 'string') {
                        // defaultSubtitle is string, match in lang then name.
                        this.options.subtitle.index = this.options.subtitle.url.findIndex((sub) =>
                            /* if (sub.lang === this.options.subtitle.defaultSubtitle) {
                            return true;
                        } else if (sub.name === this.options.subtitle.defaultSubtitle) {
                            return true;
                        } else {
                            return false;
                        } */
                            sub.lang === this.options.subtitle.defaultSubtitle ? true : sub.name === this.options.subtitle.defaultSubtitle ? true : false
                        );
                    } else if (typeof this.options.subtitle.defaultSubtitle === 'number') {
                        // defaultSubtitle is int, directly use for index
                        this.options.subtitle.index = this.options.subtitle.defaultSubtitle;
                    }
                }
                // defaultSubtitle not match or not exist or index bound(when defaultSubtitle is int), try browser language.
                if (this.options.subtitle.index === -1 || !this.options.subtitle.index || this.options.subtitle.index > this.options.subtitle.url.length - 1) {
                    this.options.subtitle.index = this.options.subtitle.url.findIndex((sub) => sub.lang === this.options.lang);
                }
                // browser language not match, default off title
                if (this.options.subtitle.index === -1) {
                    this.options.subtitle.index = this.options.subtitle.url.length - 1;
                }
            }
        }

        this.template = new Template({
            container: this.container,
            options: this.options,
            index: index,
            tran: this.tran,
        });

        this.video = this.template.video;

        this.bar = new Bar(this.template);

        this.fullScreen = new FullScreen(this);

        this.controller = new Controller(this);

        this.setting = new Setting(this);
        this.plugins = {};
        this.docClickFun = () => {
            this.focus = false;
        };
        this.containerClickFun = () => {
            this.focus = true;
        };
        document.addEventListener('click', this.docClickFun, true);
        this.container.addEventListener('click', this.containerClickFun, true);

        this.paused = true;

        this.timer = new Timer(this);

        this.initVideo(this.video, (this.quality && this.quality.type) || this.options.video.type);

        if (!this.danmaku && this.options.autoplay) {
            this.play();
        }

        this.moveBar = false;

        index++;
        instances.push(this);
    }

    /**
     * Seek video
     */
    seek(time) {
        time = Math.max(time, 0);
        if (this.video.duration) {
            time = Math.min(time, this.video.duration);
        }
        if (this.video.currentTime < time) {
            this.notice(`${this.tran('ff').replace('%s', (time - this.video.currentTime).toFixed(0))}`);
        } else if (this.video.currentTime > time) {
            this.notice(`${this.tran('rew').replace('%s', (this.video.currentTime - time).toFixed(0))}`);
        }
        try {
            this.video.currentTime = time;
        } catch (e) {
            console.error(e)
        }

        this.bar.set('played', time / this.video.duration, 'width');
        this.template.ptime.innerHTML = utils.secondToTime(time);
    }

    /**
     * Play video
     */
    play(fromNative) {
        this.paused = false;

        this.template.playButton.innerHTML = Icons.pause;
        this.template.mobilePlayButton.innerHTML = Icons.pause;

        if (!fromNative) {
            const playedPromise = Promise.resolve(this.video.play());
            playedPromise
                .catch(() => {
                    this.pause();
                })
                .then(() => {});
        }
        this.timer.enable('loading');
        this.container.classList.remove('dplayer-paused');
        this.container.classList.add('dplayer-playing');

        if (this.options.mutex) {
            for (let i = 0; i < instances.length; i++) {
                if (this !== instances[i]) {
                    instances[i].pause();
                }
            }
        }
    }

    /**
     * Pause video
     */
    pause(fromNative) {
        this.paused = true;
        this.container.classList.remove('dplayer-loading');

        this.template.playButton.innerHTML = Icons.play;
        this.template.mobilePlayButton.innerHTML = Icons.play;
        if (!fromNative) {
            this.video.pause();
        }
        this.timer.disable('loading');
        this.container.classList.remove('dplayer-playing');
        this.container.classList.add('dplayer-paused');
    }

    switchVolumeIcon() {
        if (this.volume() >= 0.95) {
            this.template.volumeIcon.innerHTML = Icons.volumeUp;
        } else if (this.volume() > 0) {
            this.template.volumeIcon.innerHTML = Icons.volumeDown;
        } else {
            this.template.volumeIcon.innerHTML = Icons.volumeOff;
        }
    }

    /**
     * Set volume
     */
    volume(percentage, nostorage, nonotice) {
        percentage = parseFloat(percentage);
        if (!isNaN(percentage)) {
            percentage = Math.max(percentage, 0);
            percentage = Math.min(percentage, 1);
            this.bar.set('volume', percentage, 'width');
            const formatPercentage = `${(percentage * 100).toFixed(0)}%`;
            // this.template.volumeBarWrapWrap.dataset.balloon = formatPercentage;
            if (!nostorage) {
                this.user.set('volume', percentage);
            }
            if (!nonotice) {
                this.notice(`${this.tran('volume')} ${(percentage * 100).toFixed(0)}%`, undefined, undefined, 'volume');
            }

            this.video.volume = percentage;
            if (this.video.muted) {
                this.video.muted = false;
            }
            this.switchVolumeIcon();
        }

        return this.video.volume;
    }

    /**
     * Toggle between play and pause
     */
    toggle() {
        if (this.video.paused) {
            this.play();
        } else {
            this.pause();
        }
    }

    /**
     * attach event
     */
    on(name, callback) {
        this.events.on(name, callback);
    }

    /**
     * Switch to a new video
     *
     * @param {Object} video - new video info
     * @param {Object} danmaku - new danmaku info
     */
    switchVideo(video, danmakuAPI) {
        this.pause();
        this.video.poster = video.pic ? video.pic : '';
        this.video.src = video.url;
    }

    initVideo(video, type) {
        // this.initMSE(video, type);

        /**
         * video events
         */
        // show video time: the metadata has loaded or changed
        this.on('durationchange', () => {
            // compatibility: Android browsers will output 1 or Infinity at first
            if (video.duration !== 1 && video.duration !== Infinity) {
                this.template.dtime.innerHTML = utils.secondToTime(video.duration);
            }
        });

        // show video loaded bar: to inform interested parties of progress downloading the media
        this.on('progress', () => {
            const percentage = video.buffered.length ? video.buffered.end(video.buffered.length - 1) / video.duration : 0;
            this.bar.set('loaded', percentage, 'width');
        });

        // video download error: an error occurs
        this.on('error', () => {
            if (!this.video.error) {
                // Not a video load error, may be poster load failed, see #307
                return;
            }
            this.tran && this.notice && this.type !== 'webtorrent' && this.notice(this.tran('video-failed'));
        });

        // video end
        this.on('ended', () => {
            this.bar.set('played', 1, 'width');
            if (!this.setting.loop) {
                this.pause();
            } else {
                this.seek(0);
                this.play();
            }
        });

        this.on('play', () => {
            if (this.paused) {
                this.play(true);
            }
        });

        this.on('pause', () => {
            if (!this.paused) {
                this.pause(true);
            }
        });

        this.on('timeupdate', () => {
            if (!this.moveBar) {
                this.bar.set('played', this.video.currentTime / this.video.duration, 'width');
            }
            const currentTime = utils.secondToTime(this.video.currentTime);
            if (this.template.ptime.innerHTML !== currentTime) {
                this.template.ptime.innerHTML = currentTime;
            }
        });

        for (let i = 0; i < this.events.videoEvents.length; i++) {
            video.addEventListener(this.events.videoEvents[i], (e) => {
                this.events.trigger(this.events.videoEvents[i], e);
            });
        }

        this.volume(this.user.get('volume'), true, true);

        if (this.options.subtitle) {
            // init old single subtitle function(sub show and style)
            this.subtitle = new Subtitle(this.template.subtitle, this.video, this.options.subtitle, this.events);
            // init multi subtitles function(sub update)
            if (Array.isArray(this.options.subtitle.url)) {
                this.subtitles = new Subtitles(this);
            }
            if (!this.user.get('subtitle')) {
                this.subtitle.hide();
            }
        }
    }

    switchQuality(index) {
        index = typeof index === 'string' ? parseInt(index) : index;
        if (this.qualityIndex === index || this.switchingQuality) {
            return;
        } else {
            this.prevIndex = this.qualityIndex;
            this.qualityIndex = index;
        }
        this.switchingQuality = true;
        this.quality = this.options.video.quality[index];
        this.template.qualityButton.innerHTML = this.quality.name;

        const paused = this.video.paused;
        this.video.pause();
        const videoHTML = tplVideo({
            current: false,
            pic: null,
            screenshot: this.options.screenshot,
            preload: 'auto',
            url: this.quality.url,
            subtitle: this.options.subtitle,
        });
        const videoEle = new DOMParser().parseFromString(videoHTML, 'text/html').body.firstChild;
        this.template.videoWrap.insertBefore(videoEle, this.template.videoWrap.getElementsByTagName('div')[0]);
        this.prevVideo = this.video;
        this.video = videoEle;
        this.initVideo(this.video, this.quality.type || this.options.video.type);
        this.seek(this.prevVideo.currentTime);
        this.notice(`${this.tran('switching-quality').replace('%q', this.quality.name)}`, -1, undefined, 'switch-quality');
        this.events.trigger('quality_start', this.quality);

        this.on('canplay', () => {
            if (this.prevVideo) {
                if (this.video.currentTime !== this.prevVideo.currentTime) {
                    this.seek(this.prevVideo.currentTime);
                    return;
                }
                this.template.videoWrap.removeChild(this.prevVideo);
                this.video.classList.add('dplayer-video-current');
                if (!paused) {
                    this.video.play();
                }
                this.prevVideo = null;
                this.notice(`${this.tran('switched-quality').replace('%q', this.quality.name)}`, undefined, undefined, 'switch-quality');
                this.switchingQuality = false;

                this.events.trigger('quality_end');
            }
        });

        this.on('error', () => {
            if (!this.video.error) {
                return;
            }
            if (this.prevVideo) {
                this.template.videoWrap.removeChild(this.video);
                this.video = this.prevVideo;
                if (!paused) {
                    this.video.play();
                }
                this.qualityIndex = this.prevIndex;
                this.quality = this.options.video.quality[this.qualityIndex];
                this.noticeTime = setTimeout(() => {
                    this.template.notice.style.opacity = 0;
                    this.events.trigger('notice_hide');
                }, 3000);
                this.prevVideo = null;
                this.switchingQuality = false;
            }
        });
    }

    notice(text, time = 2000, opacity = 0.8, id) {
        let oldNoticeEle;
        if (id) {
            oldNoticeEle = document.getElementById(`dplayer-notice-${id}`);
            if (oldNoticeEle) {
                oldNoticeEle.innerHTML = text;
            }
            if (this.noticeList[id]) {
                clearTimeout(this.noticeList[id]);
                this.noticeList[id] = null;
            }
        }
        if (!oldNoticeEle) {
            const notice = Template.NewNotice(text, opacity, id);
            this.template.noticeList.appendChild(notice);
            oldNoticeEle = notice;
        }

        this.events.trigger('notice_show', oldNoticeEle);

        if (time > 0) {
            this.noticeList[id] = setTimeout(
                (function (e, dp) {
                    return () => {
                        e.addEventListener('animationend', () => {
                            dp.template.noticeList.removeChild(e);
                        });
                        e.classList.add('remove-notice');
                        dp.events.trigger('notice_hide');
                        dp.noticeList[id] = null;
                    };
                })(oldNoticeEle, this),
                time
            );
        }
    }

    resize() {
        if (this.controller.thumbnails) {
            this.controller.thumbnails.resize(160, (this.video.videoHeight / this.video.videoWidth) * 160, this.template.barWrap.offsetWidth);
        }
        this.events.trigger('resize');
    }

    speed(rate) {
        this.video.playbackRate = rate;
    }

    destroy() {
        instances.splice(instances.indexOf(this), 1);
        this.pause();
        document.removeEventListener('click', this.docClickFun, true);
        this.container.removeEventListener('click', this.containerClickFun, true);
        this.fullScreen.destroy();
        this.controller.destroy();
        this.timer.destroy();
        this.video.src = '';
        this.container.innerHTML = '';
        this.events.trigger('destroy');
    }

    static get version() {
        /* global DPLAYER_VERSION */
        return DPLAYER_VERSION;
    }
}

export default DPlayer;
