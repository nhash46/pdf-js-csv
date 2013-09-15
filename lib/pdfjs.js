///////////////////////////////////
// From https://github.com/modesty/pdf2json/blob/master/lib/pdf.js

var    fs = require('fs'),
       _ = require('underscore'),
       nodeUtil = require("util"),
       nodeEvents = require("events");
     
var _pdfjsFiles = ['pdf.js'];

//////replacing HTML5 canvas with PDFCanvas (in-memory canvas)
function createScratchCanvas(width, height) { return new PDFCanvas({}, width, height); }

var PDFJS = {};
var globalScope = {};

var _basePath = __dirname + "/../../pdf.js/build/";
var _fileContent = '';
_.each(_pdfjsFiles, function(fileName, idx) {
    _fileContent += fs.readFileSync(_basePath + fileName, 'utf8');
});

eval(_fileContent);

////////////////////////////////start of helper classes
var PDFPageParser = (function () {
    'use strict';
    // private static
    var _nextId = 1;
    var _name = 'PDFPageParser';

    var RenderingStates = {
      INITIAL: 0,
      RUNNING: 1,
      PAUSED: 2,
      FINISHED: 3
    };

    var _addField = function(field) {
        if (!PDFField.isFormElement(field))
            return;

        var oneField = new PDFField(field, this.viewport, this.Fields, this.Boxsets);
        oneField.processField();
    };

    // constructor
    var cls = function (pdfPage, id, scale, ptiParser) {
        nodeEvents.EventEmitter.call(this);
        // private
        var _id = _nextId++;

        // public (every instance will have their own copy of these methods, needs to be lightweight)
        this.get_id = function() { return _id; };
        this.get_name = function() { return _name + _id; };

        // public, this instance copies
        this.id = id;
        this.pdfPage = pdfPage;
        this.ptiParser = ptiParser;

        this.scale = scale || 1.0;

        //leave out the 2nd parameter in order to use page's default rotation (for both portrait and landscape form)
        this.viewport = this.pdfPage.getViewport(this.scale);

        this.renderingState = RenderingStates.INITIAL;

        //form elements other than radio buttons and check boxes
        this.Fields = [];
        //form elements: radio buttons and check boxes
        this.Boxsets = [];

        //public properties
        Object.defineProperty(this, 'width', {
            get:function () {
                return PDFUnit.toFormX(this.viewport.width);
            },
            enumerable:true
        });

        Object.defineProperty(this, 'height', {
            get:function () {
                return PDFUnit.toFormY(this.viewport.height);
            },
            enumerable:true
        });
    };
    // inherit from event emitter
	nodeUtil.inherits(cls, nodeEvents.EventEmitter);

    cls.prototype.destroy = function() {
        this.pdfPage.destroy();
    };

    cls.prototype.getPagePoint = function(x, y) {
        return this.viewport.convertToPdfPoint(x, y);
    };

    cls.prototype.parsePage = function(callback, errorCallBack) {
        if (this.renderingState !== RenderingStates.INITIAL)
          error('Must be in new state before drawing');

        this.renderingState = RenderingStates.RUNNING;

        var canvas = createScratchCanvas(1, 1);
        var ctx = canvas.getContext('2d');

        var self = this;
        function pageViewDrawCallback(error) {
            self.renderingState = RenderingStates.FINISHED;

            if (error) {
                var errMsg = 'An error occurred while rendering the page ' + (self.id + 1) +
                    ':\n' + error.message +
                    ':\n' + error.stack;
                errorCallBack(errMsg);
            }
            else {
                if (self.ptiParser) {
                    var extraFields = self.ptiParser.getFields(parseInt(self.id) + 1);
                    _.each(extraFields, _addField, self);
                }

                _.extend(self, ctx.canvas);
                self.stats = self.pdfPage.stats;

                self.log('page ' + (self.id + 1) + ' is rendered successfully.');
                callback();
            }
        }

        var renderContext = {
            canvasContext:ctx,
            viewport:this.viewport
        };

        self.pdfPage.render(renderContext).then(
            function pdfPageRenderCallback() {
                self.pdfPage.getAnnotations().then(function(fields){
                    _.each(fields, _addField, self);
                    pageViewDrawCallback(null);
                });
            },
            function pdfPageRenderError(error) {
                pageViewDrawCallback(error);
            }
        );
    };

    return cls;

})();

////////////////////////////////Start of Node.js Module
var PDFJSWrapper = (function () {
    'use strict';
    // private static
    var _nextId = 1;
    var _name = 'PDFJSClass';
    var _sufInfo = "_fieldInfo.xml";

    var _getMetaDataString = function(metadata, key){
        var retVal = "unknown";
        if (metadata && metadata.has(key)) {
            retVal = encodeURIComponent(metadata.get(key));
        }
        return retVal;
    };

    var _getMetaDataInt = function(metadata, key){
        var retVal = _getMetaDataString(metadata, key);
        retVal = parseInt(retVal);
        if (retVal == null || isNaN(retVal))
            retVal = -1;
        return retVal;
    };

    // constructor
    var cls = function () {
        nodeEvents.EventEmitter.call(this);
        // private
        var _id = _nextId++;

        // public (every instance will have their own copy of these methods, needs to be lightweight)
        this.get_id = function() { return _id; };
        this.get_name = function() { return _name + _id; };

        // public, this instance copies
        this.pdfDocument = null;
        this.formImage = null;
    };
    // inherit from event emitter
	nodeUtil.inherits(cls, nodeEvents.EventEmitter);

    cls.prototype.parsePDFData = function(arrayBuffer) {
        this.pdfDocument = null;
        this.formImage = null;

        var parameters = {password: '', data: arrayBuffer};
        var self = this;
        PDFJS.getDocument(parameters).then(
            function getDocumentCallback(pdfDocument) {
                self.load(pdfDocument, 1);
            },
            function getDocumentError(message, exception) {
                var errMsg = "An error occurred while parsing the PDF: " + message;
                self.log(errMsg);
                self.emit("pdfjs_parseDataError", errMsg);
            },
            function getDocumentProgress(progressData) {
                self.log("Loading progress: " + progressData.loaded / progressData.total + "%");
            }
        );
    };

    cls.prototype.tryLoadFieldInfoXML = function(pdfFilePath) {
        var fieldInfoXMLPath = pdfFilePath.replace(".pdf", _sufInfo);
        if ((fieldInfoXMLPath.indexOf(_sufInfo) < 1) || (!fs.existsSync(fieldInfoXMLPath))) {
            return;
        }
        self.log("About to load fieldInfo XML : " + fieldInfoXMLPath);

        var PTIXmlParser = require('./ptixmlinject');
        this.ptiParser = new PTIXmlParser();
        this.ptiParser.parseXml(fieldInfoXMLPath, _.bind(function(err) {
            if (err) {
                self.log("fieldInfo XML Error: " + JSON.stringify(err));
                this.ptiParser = null;
            }
            else {
                self.log("fieldInfo XML loaded.");
            }
        }, this));
    };

    cls.prototype.run = function(filename) {
        console.log("running");
        this.load(filename, 1);
    };

    cls.prototype.log = function(msg) {
       console.log(msg);
    };


    cls.prototype.load = function(pdfDocument, scale) {
        this.pdfDocument = pdfDocument;

        this.pages = [];
        this.pageWidth = 0;

        var pagesCount = pdfDocument.numPages;
        var pagePromises = [];
        for (var i = 1; i <= pagesCount; i++)
          pagePromises.push(pdfDocument.getPage(i));

        var pagesPromise = PDFJS.Promise.all(pagePromises);

        var self = this;
        self.log("PDF loaded. pagesCount = " + pagesCount);
        pagesPromise.then(function(promisedPages) {
            self.parsePage(promisedPages, 0, 1.5);
        });

        pdfDocument.getMetadata().then(function(data) {
            self.documentInfo = data.info;
            self.metadata = data.metadata;

            self.parseMetaData();
        });
    };

    cls.prototype.parseMetaData = function() {
        var self = this;

        var info = self.documentInfo;
        var metadata = self.metadata;

        var pdfTile = "";
        if (metadata && metadata.has('dc:title')) {
            pdfTile = metadata.get('dc:title');
        }
        else if (info && info['Title'])
            pdfTile = info['Title'];

        var formAttr = {AgencyId:"", Name: "", MC: false, Max: 1, Parent:""};
        if (metadata) {
            formAttr.AgencyId = _getMetaDataString(metadata, 'pdfx:agencyid');
            if (formAttr.AgencyId != "unknown")
                pdfTile = formAttr.AgencyId;

            formAttr.Name = _getMetaDataString(metadata, 'pdfx:name');
            formAttr.MC = _getMetaDataString(metadata, 'pdfx:mc') === 'true';
            formAttr.Max = _getMetaDataInt(metadata, 'pdfx:max');
            formAttr.Parent = _getMetaDataInt(metadata, 'pdfx:parent');
        }

        self.emit("pdfjs_parseDataReady", {Transcoder: pkInfo._id, Agency:pdfTile, Id: formAttr});
    };

    cls.prototype.parsePage = function(promisedPages, id, scale) {
        var self = this;
        self.log("start to parse page:" + (id+1));
        var pdfPage = promisedPages[id];
        var pageParser = new PDFPageParser(pdfPage, id, scale, this.ptiParser);

        pageParser.parsePage(function() {
            if (!self.pageWidth)  //get PDF width
                self.pageWidth = pageParser.width;

            var page = {Height: pageParser.height,
                HLines: pageParser.HLines,
                VLines: pageParser.VLines,
                Fills:pageParser.Fills,
                Texts: pageParser.Texts,
                Fields: pageParser.Fields,
                Boxsets: pageParser.Boxsets
            };

            self.pages.push(page);

            if (id === (self.pdfDocument.numPages - 1) ) {
                self.log("complete parsing page:" + (id+1));
                self.emit("pdfjs_parseDataReady", {Pages:self.pages, Width: self.pageWidth});
            }
            else {
                process.nextTick(function(){
                    self.parsePage(promisedPages, ++id, scale);
                });
            }
        }, function(errMsg) {
            self.emit("pdfjs_parseDataError", errMsg);
        });
    };

    cls.prototype.destroy = function() {
        this.removeAllListeners();

        if (this.pdfDocument)
            this.pdfDocument.destroy();
        this.pdfDocument = null;

        this.formImage = null;
    };

    return cls;
})();

module.exports = PDFJSWrapper;
////////////////////////////////End of Node.js Module
