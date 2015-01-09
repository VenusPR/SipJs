/**
 * Dependencies.
 */
var browserify = require('browserify');
var vinyl_transform = require('vinyl-transform');
var gulp = require('gulp');
var gutil = require('gulp-util');
var jshint = require('gulp-jshint');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var filelog = require('gulp-filelog');
var header = require('gulp-header');
var expect = require('gulp-expect-file');
var nodeunit = require('gulp-nodeunit-runner');
var fs = require('fs');
var fs_extra = require('fs-extra');
var path = require('path');
var exec = require('child_process').exec;
var pkg = require('./package.json');


// Build filenames.
var builds = {
	uncompressed: pkg.name + '-' + pkg.version + '.js',
	compressed:   pkg.name + '-' + pkg.version + '.min.js'
};

// gulp-header.
var banner = fs.readFileSync('banner.txt').toString();
var banner_options = {
	pkg: pkg,
	currentYear: (new Date()).getFullYear()
};

// gulp-expect-file options.
var expect_options = {
	silent: true,
	errorOnFailure: true,
	checkRealFile: true
};


gulp.task('lint', function() {
	var src = ['gulpfile.js', 'lib/**/*.js', 'test/**/*.js'];
	return gulp.src(src)
		.pipe(filelog('lint'))
		.pipe(expect(expect_options, src))
		.pipe(jshint('.jshintrc'))
		.pipe(jshint.reporter('jshint-stylish', {verbose: true}))
		.pipe(jshint.reporter('fail'));
});


gulp.task('browserify', function() {
	var browserified = vinyl_transform(function(filename) {
		var b = browserify(filename, {
			standalone: pkg.title
		});
		return b.bundle();
	});

	var src = pkg.main;
	return gulp.src(src)
		.pipe(filelog('browserify'))
		.pipe(expect(expect_options, src))
		.pipe(browserified)
		.pipe(header(banner, banner_options))
		.pipe(rename(builds.uncompressed))
		.pipe(gulp.dest('dist/'));
});


gulp.task('uglify', function() {
	var src = 'dist/' + builds.uncompressed;
	return gulp.src(src)
		.pipe(filelog('uglify'))
		.pipe(expect(expect_options, src))
		.pipe(uglify())
		.pipe(header(banner, banner_options))
		.pipe(rename(builds.compressed))
		.pipe(gulp.dest('dist/'));
});


gulp.task('copy', function(cb) {
	fs_extra.copySync('dist/' + builds.uncompressed, 'dist/' + pkg.name + '.js');
	cb();
});


gulp.task('test', function() {
	var src = 'test/*.js';
	return gulp.src(src)
		.pipe(filelog('test'))
		.pipe(expect(expect_options, src))
		.pipe(nodeunit({reporter: 'default'}));
});


gulp.task('watch', function() {
	gulp.watch(['lib/**/*.js'], ['devel']);
});


gulp.task('grammar', function(cb) {
	var local_pegjs = path.resolve('./node_modules/.bin/pegjs');
	var Grammar_pegjs = path.resolve('lib/Grammar.pegjs');
	var Grammar_js = path.resolve('lib/Grammar.js');

	gutil.log('grammar: compiling Grammar.pegjs into Grammar.js...');

	exec(local_pegjs + ' ' + Grammar_pegjs + ' ' + Grammar_js,
		function(error, stdout, stderr) {
			if (error) {
				cb(new Error(stderr));
			}
			gutil.log('grammar: ' + gutil.colors.yellow('done'));

			// Modify the generated Grammar.js file with custom changes.
			gutil.log('grammar: applying custom changes to Grammar.js...');

			var grammar = fs.readFileSync('lib/Grammar.js').toString();
			var modified_grammar = grammar.replace(/throw new this\.SyntaxError\(([\s\S]*?)\);([\s\S]*?)}([\s\S]*?)return result;/, 'new this.SyntaxError($1);\n        return -1;$2}$3return data;');
			fs.writeFileSync('lib/Grammar.js', modified_grammar);
			gutil.log('grammar: ' + gutil.colors.yellow('done'));
			cb();
		}
	);
});


gulp.task('devel', gulp.series('grammar'));
gulp.task('dist', gulp.series('lint', 'test', 'browserify', 'uglify', 'copy'));
gulp.task('default', gulp.series('dist'));
